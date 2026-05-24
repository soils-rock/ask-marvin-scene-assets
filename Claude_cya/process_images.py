#!/usr/bin/env python3
"""
Process background images - perform stacking or copying based on request
"""

import os
import sys
import rawpy
import numpy as np
import cv2
from PIL import Image
from pathlib import Path
import json

class BackgroundProcessor:
    def __init__(self, work_dir):
        self.work_dir = Path(work_dir)
        self.bg_processed_dir = self.work_dir / "processed_backgrounds"
        self.bg_processed_dir.mkdir(parents=True, exist_ok=True)
        self.fg_processed_dir = self.work_dir / "processed_foregrounds"
        self.fg_processed_dir.mkdir(parents=True, exist_ok=True)
        
    def convert_cr2_to_array(self, cr2_path):
        """Convert CR2 to numpy array for processing"""
        print(f"  Loading {Path(cr2_path).name}...")
        with rawpy.imread(str(cr2_path)) as raw:
            rgb = raw.postprocess(
                use_camera_wb=True,
                output_bps=16,
                no_auto_bright=False,
                bright=1.0
            )
        return rgb
    
    def focus_stack(self, image_arrays):
        """Perform focus stacking using Laplacian pyramid - closer to Photoshop's auto-blend"""
        print("  Performing focus stack...")
        
        # Convert to 8-bit for OpenCV processing
        images_8bit = [cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8) for img in image_arrays]
        
        # Align images first (like Photoshop Auto-Align)
        print("  Auto-aligning images...")
        aligned_images = self.align_images_advanced(images_8bit)
        
        # Focus stack with better blending (like Photoshop Auto-Blend)
        print("  Auto-blending focused regions...")
        result = self.blend_focus_stack(aligned_images)
        
        return result
    
    def align_images_advanced(self, images):
        """Advanced alignment using feature-based matching (closer to Photoshop)"""
        if len(images) < 2:
            return images
        
        reference = images[0]
        aligned = [reference]
        
        for i, img in enumerate(images[1:], 1):
            try:
                # Convert to grayscale
                ref_gray = cv2.cvtColor(reference, cv2.COLOR_RGB2GRAY)
                img_gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
                
                # Try ORB feature detection first (faster)
                orb = cv2.ORB_create(5000)
                kp1, des1 = orb.detectAndCompute(ref_gray, None)
                kp2, des2 = orb.detectAndCompute(img_gray, None)
                
                if des1 is not None and des2 is not None and len(des1) > 10 and len(des2) > 10:
                    # Match features
                    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
                    matches = bf.match(des1, des2)
                    matches = sorted(matches, key=lambda x: x.distance)
                    
                    # Use top matches
                    good_matches = matches[:min(50, len(matches))]
                    
                    if len(good_matches) > 10:
                        # Get matching points
                        src_pts = np.float32([kp2[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)
                        dst_pts = np.float32([kp1[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
                        
                        # Find homography
                        M, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
                        
                        if M is not None:
                            # Warp image
                            h, w = reference.shape[:2]
                            aligned_img = cv2.warpPerspective(img, M, (w, h))
                            aligned.append(aligned_img)
                            print(f"    Aligned image {i+1} using feature matching")
                            continue
                
                # Fall back to ECC if feature matching fails
                print(f"    Falling back to ECC alignment for image {i+1}")
                warp_mode = cv2.MOTION_EUCLIDEAN
                warp_matrix = np.eye(2, 3, dtype=np.float32)
                criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 5000, 1e-10)
                
                _, warp_matrix = cv2.findTransformECC(ref_gray, img_gray, warp_matrix, warp_mode, criteria)
                
                aligned_img = cv2.warpAffine(img, warp_matrix, (reference.shape[1], reference.shape[0]),
                                            flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP)
                aligned.append(aligned_img)
                print(f"    Aligned image {i+1} using ECC")
                
            except Exception as e:
                print(f"    Warning: Could not align image {i+1}, using original: {e}")
                aligned.append(img)
        
        return aligned
    
    def blend_focus_stack(self, images):
        """Better focus stacking with smoothed transitions"""
        if len(images) == 1:
            return images[0]
        
        # Calculate focus measure for each image using Laplacian
        focus_measures = []
        for img in images:
            gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
            laplacian = cv2.Laplacian(gray, cv2.CV_64F)
            focus_measure = np.abs(laplacian)
            # Smooth the focus measure to reduce noise
            focus_measure = cv2.GaussianBlur(focus_measure, (15, 15), 0)
            focus_measures.append(focus_measure)
        
        focus_measures = np.array(focus_measures)
        
        # Find best focused image for each pixel
        best_indices = np.argmax(focus_measures, axis=0)
        
        # Create smooth blending masks
        masks = []
        for i in range(len(images)):
            mask = (best_indices == i).astype(np.float32)
            # Smooth the mask edges for seamless blending
            mask = cv2.GaussianBlur(mask, (31, 31), 0)
            masks.append(mask)
        
        # Normalize masks so they sum to 1 at each pixel
        mask_stack = np.stack(masks, axis=0)
        mask_sum = np.sum(mask_stack, axis=0)
        mask_sum[mask_sum == 0] = 1  # Avoid division by zero
        normalized_masks = mask_stack / mask_sum
        
        # Blend images using normalized masks
        result = np.zeros_like(images[0], dtype=np.float32)
        for i, img in enumerate(images):
            mask_3ch = np.stack([normalized_masks[i]] * 3, axis=2)
            result += img.astype(np.float32) * mask_3ch
        
        result = np.clip(result, 0, 255).astype(np.uint8)
        return result
    
    def align_images(self, images):
        """Align images using ECC"""
        if len(images) < 2:
            return images
        
        reference = images[0]
        aligned = [reference]
        
        for i, img in enumerate(images[1:], 1):
            try:
                ref_gray = cv2.cvtColor(reference, cv2.COLOR_RGB2GRAY)
                img_gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
                
                warp_mode = cv2.MOTION_TRANSLATION
                warp_matrix = np.eye(2, 3, dtype=np.float32)
                criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 1000, 1e-6)
                
                _, warp_matrix = cv2.findTransformECC(ref_gray, img_gray, warp_matrix, warp_mode, criteria)
                
                aligned_img = cv2.warpAffine(img, warp_matrix, (reference.shape[1], reference.shape[0]),
                                            flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP)
                aligned.append(aligned_img)
                print(f"    Aligned image {i+1}")
            except Exception as e:
                print(f"    Warning: Could not align image {i+1}, using original: {e}")
                aligned.append(img)
        
        return aligned
    
    def save_image(self, image_array, output_path):
        """Save numpy array as PNG"""
        if image_array.dtype != np.uint8:
            image_array = cv2.normalize(image_array, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        
        img = Image.fromarray(image_array)
        img.save(output_path, "PNG")
        print(f"  ✅ Saved: {output_path}")
    
    def process_request(self, request_file):
        """Process a request from JSON file"""
        print("="*60)
        print("Processing Request")
        print("="*60)
        
        with open(request_file, 'r') as f:
            request = json.load(f)
        
        action = request['action']
        folder = request['folder']
        images = request['images']
        img_type = request.get('type', 'background')  # default to background for compatibility
        
        # Choose correct output directory
        processed_dir = self.fg_processed_dir if img_type == 'foreground' else self.bg_processed_dir
        
        print(f"\nType: {img_type}")
        print(f"Folder: {folder}")
        print(f"Action: {action}")
        print(f"Images: {len(images)}")
        
        if action == 'select':
            # Single image - just copy it
            print("\n📄 Single image selected - copying...")
            source = images[0]['source_path']
            
            # Load and save
            img_array = self.convert_cr2_to_array(source)
            output_name = f"{folder}.png"
            output_path = processed_dir / output_name
            
            self.save_image(img_array, output_path)
            
            print(f"\n✅ Complete! Saved as: {output_name}")
            return output_path
            
        elif action == 'stack':
            # Multiple images - stack them
            print(f"\n📚 Stacking {len(images)} images...")
            
            # Load all images
            image_arrays = []
            for img in images:
                arr = self.convert_cr2_to_array(img['source_path'])
                image_arrays.append(arr)
            
            # Stack them
            stacked = self.focus_stack(image_arrays)
            
            # Save result
            output_name = f"{folder}_stacked.png"
            output_path = processed_dir / output_name
            
            self.save_image(stacked, output_path)
            
            print(f"\n✅ Complete! Stacked result saved as: {output_name}")
            print(f"\nSource files stacked:")
            for img in images:
                print(f"  - {img['original']}")
            
            return output_path
        
        else:
            print(f"Unknown action: {action}")
            return None
    
    def process_from_downloads(self):
        """Look for process_request.json in Downloads folder"""
        downloads = Path.home() / "Downloads"
        request_file = downloads / "process_request.json"
        
        if not request_file.exists():
            print(f"Error: No process_request.json found in {downloads}")
            print("\nPlease:")
            print("  1. Select images in the web interface")
            print("  2. Click 'Process Selection' to download the request file")
            print("  3. Run this script again")
            return None
        
        print(f"Found request file: {request_file}")
        result = self.process_request(request_file)
        
        # Move processed file to avoid re-processing
        if result:
            processed_request = downloads / f"process_request_done_{result.stem}.json"
            request_file.rename(processed_request)
            print(f"\n📦 Moved request file to: {processed_request.name}")
        
        return result


if __name__ == "__main__":
    work_dir = "/Users/bcottraven/CyanoVerse/Image_Processing"
    
    processor = BackgroundProcessor(work_dir)
    
    if len(sys.argv) > 1:
        # Process specific file
        request_file = sys.argv[1]
        processor.process_request(request_file)
    else:
        # Look in Downloads
        result = processor.process_from_downloads()
        
        if result:
            print("\n" + "="*60)
            print("🎉 Success!")
            print("="*60)
            print(f"\nProcessed image saved to:")
            print(f"  {result}")
            print(f"\nYou can now:")
            print(f"  1. Review the result")
            print(f"  2. Continue processing more images in the web interface")
