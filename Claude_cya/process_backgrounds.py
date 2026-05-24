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
        self.processed_dir = self.work_dir / "processed_backgrounds"
        self.processed_dir.mkdir(parents=True, exist_ok=True)
        
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
        """Perform focus stacking using Laplacian pyramid"""
        print("  Performing focus stack...")
        
        # Convert to 8-bit for OpenCV processing
        images_8bit = [cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8) for img in image_arrays]
        
        # Align images first
        print("  Aligning images...")
        aligned_images = self.align_images(images_8bit)
        
        # Use Laplacian for focus measure
        print("  Blending focused regions...")
        laplacians = []
        for img in aligned_images:
            gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
            laplacian = cv2.Laplacian(gray, cv2.CV_64F)
            laplacians.append(laplacian)
        
        laplacians = np.array(laplacians)
        best_focus_indices = np.argmax(np.abs(laplacians), axis=0)
        
        # Blend images based on focus
        result = np.zeros_like(aligned_images[0])
        for i in range(len(aligned_images)):
            mask = (best_focus_indices == i).astype(np.uint8)
            mask = cv2.GaussianBlur(mask, (5, 5), 0)
            mask = np.stack([mask] * 3, axis=2)
            result = result + (aligned_images[i] * mask).astype(np.uint8)
        
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
        
        print(f"\nFolder: {folder}")
        print(f"Action: {action}")
        print(f"Images: {len(images)}")
        
        if action == 'select':
            # Single image - just copy it
            print("\n📄 Single image selected - copying...")
            source = images[0]['source_path']
            
            # Load and save
            img_array = self.convert_cr2_to_array(source)
            output_name = f"{folder}.png"
            output_path = self.processed_dir / output_name
            
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
            output_path = self.processed_dir / output_name
            
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
