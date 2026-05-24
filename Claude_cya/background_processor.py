#!/usr/bin/env python3
"""
Ask-Marvin Background Processor
Step 1: Analyze, stack, and preview background images
"""

import os
import sys
import rawpy
import numpy as np
import cv2
from PIL import Image
from pathlib import Path
from collections import defaultdict
import json

class BackgroundProcessor:
    def __init__(self, base_path):
        self.base_path = Path(base_path)
        self.backgrounds_raw = self.base_path / "Backgrounds_Raw"
        self.preview_dir = Path.home() / "ask-marvin-previews" / "backgrounds"
        self.preview_dir.mkdir(parents=True, exist_ok=True)
        
    def find_unprocessed_folders(self):
        """Find folders without 'x' prefix"""
        unprocessed = []
        for item in self.backgrounds_raw.iterdir():
            if item.is_dir() and not item.name.startswith('x'):
                unprocessed.append(item)
        return unprocessed
    
    def analyze_images(self, folder_path):
        """Analyze CR2 files to determine if they should be stacked"""
        cr2_files = sorted(folder_path.glob("*.CR2"))
        
        if len(cr2_files) < 2:
            return {"single_images": cr2_files, "stack_groups": []}
        
        # Read EXIF data
        image_info = []
        for cr2_file in cr2_files:
            try:
                with rawpy.imread(str(cr2_file)) as raw:
                    # Extract key metadata
                    info = {
                        'file': cr2_file,
                        'filename': cr2_file.name,
                        'iso': raw.camera_white_level_per_channel[0] if hasattr(raw, 'camera_white_level_per_channel') else None,
                        'raw_pattern': raw.raw_pattern.tolist() if hasattr(raw, 'raw_pattern') else None,
                    }
                    
                    # Get EXIF if available
                    if hasattr(raw, 'metadata'):
                        info['timestamp'] = getattr(raw.metadata, 'timestamp', None)
                    
                    image_info.append(info)
            except Exception as e:
                print(f"Warning: Could not read {cr2_file.name}: {e}")
        
        # Analyze: if images are sequential and close in time, likely a stack
        if len(image_info) >= 2:
            # Check if filenames are sequential (IMG_1360, IMG_1361, IMG_1362)
            file_numbers = []
            for info in image_info:
                try:
                    # Extract number from filename like IMG_1360.CR2
                    num = int(info['filename'].split('_')[1].split('.')[0])
                    file_numbers.append(num)
                except:
                    file_numbers.append(None)
            
            # If sequential numbers (difference of 1), likely a stack
            is_sequential = all(
                file_numbers[i+1] == file_numbers[i] + 1 
                for i in range(len(file_numbers)-1)
                if file_numbers[i] is not None and file_numbers[i+1] is not None
            )
            
            if is_sequential and len(image_info) <= 10:  # Reasonable stack size
                return {
                    "single_images": [],
                    "stack_groups": [image_info],
                    "stack_type": "focus_stack" if len(image_info) <= 5 else "exposure_bracket"
                }
        
        # Default: treat as separate images
        return {"single_images": [info['file'] for info in image_info], "stack_groups": []}
    
    def convert_cr2_to_array(self, cr2_path):
        """Convert CR2 to numpy array for processing"""
        with rawpy.imread(str(cr2_path)) as raw:
            # Use auto white balance and default processing
            rgb = raw.postprocess(
                use_camera_wb=True,
                output_bps=16,
                no_auto_bright=False,
                bright=1.0
            )
        return rgb
    
    def stack_images(self, image_files, stack_type="focus_stack"):
        """Stack multiple images using focus stacking or exposure blending"""
        print(f"  Loading {len(image_files)} images for stacking...")
        
        # Load all images
        images = []
        for img_info in image_files:
            img_path = img_info['file']
            print(f"    - {img_path.name}")
            rgb = self.convert_cr2_to_array(img_path)
            images.append(rgb)
        
        if stack_type == "focus_stack":
            return self.focus_stack(images)
        else:
            return self.exposure_blend(images)
    
    def focus_stack(self, images):
        """Perform focus stacking using Laplacian pyramid"""
        print("  Performing focus stack...")
        
        # Convert to 8-bit for OpenCV processing
        images_8bit = [cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8) for img in images]
        
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
        
        # Find the best focused regions
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
    
    def exposure_blend(self, images):
        """Blend multiple exposures"""
        print("  Performing exposure blend...")
        
        # Convert to 8-bit
        images_8bit = [cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8) for img in images]
        
        # Align images
        aligned_images = self.align_images(images_8bit)
        
        # Simple average blend (can be improved with HDR techniques)
        result = np.mean(aligned_images, axis=0).astype(np.uint8)
        
        return result
    
    def align_images(self, images):
        """Align images using ECC (Enhanced Correlation Coefficient)"""
        if len(images) < 2:
            return images
        
        reference = images[0]
        aligned = [reference]
        
        for i, img in enumerate(images[1:], 1):
            try:
                # Convert to grayscale for alignment
                ref_gray = cv2.cvtColor(reference, cv2.COLOR_RGB2GRAY)
                img_gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
                
                # Define motion model (translation only for focus stacks)
                warp_mode = cv2.MOTION_TRANSLATION
                warp_matrix = np.eye(2, 3, dtype=np.float32)
                
                # Specify criteria for alignment
                criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 1000, 1e-6)
                
                # Align
                _, warp_matrix = cv2.findTransformECC(ref_gray, img_gray, warp_matrix, warp_mode, criteria)
                
                # Warp image
                aligned_img = cv2.warpAffine(img, warp_matrix, (reference.shape[1], reference.shape[0]),
                                            flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP)
                aligned.append(aligned_img)
            except Exception as e:
                print(f"    Warning: Could not align image {i}, using original: {e}")
                aligned.append(img)
        
        return aligned
    
    def save_preview(self, image_array, output_path):
        """Save numpy array as PNG preview"""
        # Convert to PIL Image
        if image_array.dtype != np.uint8:
            image_array = cv2.normalize(image_array, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        
        img = Image.fromarray(image_array)
        img.save(output_path, "PNG")
        print(f"  Saved preview: {output_path}")
    
    def process_folder(self, folder_path):
        """Process a single folder: analyze, stack if needed, generate previews"""
        print(f"\n{'='*60}")
        print(f"Processing: {folder_path.name}")
        print(f"{'='*60}")
        
        # Analyze images
        analysis = self.analyze_images(folder_path)
        
        results = {
            'folder': folder_path.name,
            'stacked_images': [],
            'single_images': []
        }
        
        # Process stack groups
        if analysis['stack_groups']:
            for idx, stack_group in enumerate(analysis['stack_groups']):
                stack_name = f"{folder_path.name}_stacked_{idx+1}"
                print(f"\n📚 Stack Group {idx+1} ({analysis.get('stack_type', 'unknown')}):")
                
                filenames = [info['filename'] for info in stack_group]
                print(f"  Files: {', '.join(filenames)}")
                
                # Stack the images
                stacked = self.stack_images(stack_group, analysis.get('stack_type', 'focus_stack'))
                
                # Save preview
                preview_path = self.preview_dir / f"{stack_name}.png"
                self.save_preview(stacked, preview_path)
                
                results['stacked_images'].append({
                    'name': stack_name,
                    'source_files': filenames,
                    'preview': str(preview_path),
                    'type': analysis.get('stack_type', 'unknown')
                })
        
        # Process single images
        if analysis['single_images']:
            print(f"\n📷 Individual Images:")
            for img_path in analysis['single_images']:
                print(f"  - {img_path.name}")
                
                # Convert to preview
                rgb = self.convert_cr2_to_array(img_path)
                preview_path = self.preview_dir / f"{folder_path.name}_{img_path.stem}.png"
                self.save_preview(rgb, preview_path)
                
                results['single_images'].append({
                    'name': img_path.stem,
                    'source_file': img_path.name,
                    'preview': str(preview_path)
                })
        
        return results
    
    def run(self):
        """Main processing workflow"""
        print("Ask-Marvin Background Processor")
        print("="*60)
        
        # Find unprocessed folders
        unprocessed = self.find_unprocessed_folders()
        
        if not unprocessed:
            print("No unprocessed folders found!")
            return
        
        print(f"\nFound {len(unprocessed)} unprocessed folder(s):")
        for folder in unprocessed:
            print(f"  - {folder.name}")
        
        # Process each folder
        all_results = []
        for folder in unprocessed:
            results = self.process_folder(folder)
            all_results.append(results)
        
        # Save results summary
        summary_path = self.preview_dir / "processing_summary.json"
        with open(summary_path, 'w') as f:
            json.dump(all_results, f, indent=2)
        
        print(f"\n{'='*60}")
        print("✅ Processing Complete!")
        print(f"{'='*60}")
        print(f"\nPreviews saved to: {self.preview_dir}")
        print(f"Summary saved to: {summary_path}")
        print(f"\nNext steps:")
        print("  1. Review the preview images")
        print("  2. Check the processing_summary.json file")
        print("  3. Verify stacking results look correct")
        
        # Try to open the preview folder
        try:
            os.system(f'open "{self.preview_dir}"')
        except:
            pass
        
        return all_results


if __name__ == "__main__":
    # Use the Marvin volume path
    base_path = "/Volumes/Marvin/CyanoVerse_Source_Files"
    
    processor = BackgroundProcessor(base_path)
    processor.run()
