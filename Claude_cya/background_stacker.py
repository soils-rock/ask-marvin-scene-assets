#!/usr/bin/env python3
"""
Ask-Marvin Background Image Stacker
Shows all images, lets you select which ones to stack together
"""

import os
import rawpy
import numpy as np
import cv2
from PIL import Image
from pathlib import Path
import json

class BackgroundStacker:
    def __init__(self, work_dir):
        self.work_dir = Path(work_dir)
        
        # Source files on external drive
        self.base_path = Path("/Volumes/Marvin/CyanoVerse_Source_Files")
        self.backgrounds_raw = self.base_path / "Backgrounds_Raw"
        
        # Everything goes in work_dir
        self.preview_dir = self.work_dir / "background_stack_previews"
        self.preview_dir.mkdir(parents=True, exist_ok=True)
        
        self.stacked_dir = self.work_dir / "background_stacked_results"
        self.stacked_dir.mkdir(parents=True, exist_ok=True)
        
    def find_unprocessed_folders(self):
        """Find folders without 'x' prefix"""
        unprocessed = []
        for item in self.backgrounds_raw.iterdir():
            if item.is_dir() and not item.name.startswith('x'):
                unprocessed.append(item)
        return unprocessed
    
    def convert_cr2_to_png(self, cr2_path, output_path):
        """Convert CR2 to PNG"""
        print(f"  Converting {cr2_path.name}...")
        with rawpy.imread(str(cr2_path)) as raw:
            # Use auto white balance and default processing
            rgb = raw.postprocess(
                use_camera_wb=True,
                output_bps=8,
                no_auto_bright=False,
                bright=1.0
            )
        
        # Save as PNG
        img = Image.fromarray(rgb)
        
        # Create a reasonable size preview (not too huge)
        max_size = 1920
        if img.width > max_size or img.height > max_size:
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        
        img.save(output_path, "PNG")
        return output_path
    
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
    
    def process_folder(self, folder_path):
        """Process a folder and convert all CR2s to PNGs"""
        print(f"\nProcessing folder: {folder_path.name}")
        
        cr2_files = sorted(folder_path.glob("*.CR2"))
        
        if not cr2_files:
            print("  No CR2 files found!")
            return None
        
        converted_images = []
        for cr2_file in cr2_files:
            output_name = f"{folder_path.name}_{cr2_file.stem}.png"
            output_path = self.preview_dir / output_name
            
            self.convert_cr2_to_png(cr2_file, output_path)
            
            converted_images.append({
                'original': cr2_file.name,
                'preview': output_name,
                'path': str(output_path),
                'source_path': str(cr2_file)
            })
        
        return {
            'folder': folder_path.name,
            'folder_path': str(folder_path),
            'images': converted_images
        }
    
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
    
    def create_html_viewer(self, all_results):
        """Create an HTML file for selecting images to stack"""
        html_path = self.work_dir / "background_stacker.html"
        
        html_content = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ask-Marvin Background Stacker</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: #1a1a1a;
            color: #e0e0e0;
            padding: 20px;
        }
        
        h1 {
            text-align: center;
            margin-bottom: 30px;
            color: #4a9eff;
        }
        
        .folder-section {
            margin-bottom: 50px;
            background: #2a2a2a;
            border-radius: 10px;
            padding: 20px;
        }
        
        .folder-title {
            font-size: 24px;
            margin-bottom: 20px;
            color: #66d9ef;
            border-bottom: 2px solid #444;
            padding-bottom: 10px;
        }
        
        .image-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }
        
        .image-card {
            background: #333;
            border-radius: 8px;
            padding: 15px;
            transition: all 0.2s;
            position: relative;
        }
        
        .image-card:hover {
            transform: scale(1.02);
            box-shadow: 0 4px 20px rgba(74, 158, 255, 0.3);
        }
        
        .image-card.selected {
            border: 3px solid #f92672;
            background: #3a3a3a;
        }
        
        .image-card img {
            width: 100%;
            height: auto;
            border-radius: 5px;
            cursor: pointer;
        }
        
        .image-label {
            text-align: center;
            margin-top: 10px;
            font-size: 14px;
            color: #a0a0a0;
        }
        
        .image-filename {
            font-family: 'Courier New', monospace;
            color: #f92672;
            font-weight: bold;
        }
        
        .checkbox-container {
            display: flex;
            align-items: center;
            justify-content: center;
            margin-top: 10px;
            gap: 8px;
        }
        
        .checkbox-container input[type="checkbox"] {
            width: 20px;
            height: 20px;
            cursor: pointer;
        }
        
        .checkbox-container label {
            cursor: pointer;
            font-weight: bold;
            color: #f92672;
        }
        
        .lightbox {
            display: none;
            position: fixed;
            z-index: 999;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.95);
            justify-content: center;
            align-items: center;
        }
        
        .lightbox.active {
            display: flex;
        }
        
        .lightbox img {
            max-width: 95%;
            max-height: 95%;
            object-fit: contain;
        }
        
        .lightbox-close {
            position: absolute;
            top: 20px;
            right: 40px;
            font-size: 40px;
            color: white;
            cursor: pointer;
            font-weight: bold;
        }
        
        .instructions {
            background: #3a2a2a;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 30px;
            border-left: 4px solid #f92672;
        }
        
        .instructions h2 {
            margin-bottom: 10px;
            color: #f92672;
        }
        
        .instructions ul {
            margin-left: 20px;
        }
        
        .instructions li {
            margin: 5px 0;
        }
        
        .instructions code {
            background: #1a1a1a;
            padding: 2px 6px;
            border-radius: 3px;
            color: #f92672;
        }
        
        .button-container {
            position: fixed;
            bottom: 30px;
            right: 30px;
            z-index: 100;
            display: flex;
            gap: 15px;
        }
        
        .action-button {
            background: #f92672;
            color: white;
            border: none;
            padding: 15px 30px;
            font-size: 16px;
            font-weight: bold;
            border-radius: 8px;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(249, 38, 114, 0.4);
            transition: all 0.2s;
            position: relative;
        }
        
        .action-button:hover {
            background: #ff4081;
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(249, 38, 114, 0.6);
        }
        
        .action-button:active {
            transform: translateY(0);
        }
        
        .action-button:disabled {
            background: #555;
            cursor: not-allowed;
            box-shadow: none;
        }
        
        .selection-count {
            background: #4a9eff;
            color: white;
            border-radius: 50%;
            padding: 5px 10px;
            font-size: 14px;
            position: absolute;
            top: -10px;
            right: -10px;
            min-width: 25px;
            text-align: center;
        }
        
        .status-message {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4a9eff;
            color: white;
            padding: 15px 25px;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
            display: none;
            z-index: 1000;
            max-width: 400px;
        }
        
        .status-message.show {
            display: block;
            animation: slideIn 0.3s ease-out;
        }
        
        .status-message.success {
            background: #66d966;
        }
        
        .status-message.error {
            background: #f92672;
        }
        
        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
    </style>
</head>
<body>
    <h1>📚 Ask-Marvin Background Stacker</h1>
    
    <div class="instructions">
        <h2>Instructions:</h2>
        <ul>
            <li>Click any image to view it full-size</li>
            <li>Check the boxes for images you want to <strong>stack together</strong></li>
            <li>Select 2 or more images to enable stacking</li>
            <li>Click "Stack Selected Images" to perform focus stacking</li>
            <li>The stacked result will be shown for review</li>
        </ul>
    </div>
    
    <div class="status-message" id="statusMessage">Processing...</div>
"""
        
        # Add each folder section
        for result in all_results:
            if result is None:
                continue
                
            html_content += f"""
    <div class="folder-section">
        <div class="folder-title">📁 {result['folder']}</div>
        <div class="image-grid">
"""
            
            for idx, img in enumerate(result['images']):
                rel_path = f"background_stack_previews/{img['preview']}"
                card_id = f"{result['folder']}_{idx}"
                html_content += f"""
            <div class="image-card" id="card_{card_id}">
                <img src="{rel_path}" 
                     alt="{img['original']}"
                     onclick="openLightbox(this.src)">
                <div class="image-label">
                    <span class="image-filename">{img['original']}</span>
                </div>
                <div class="checkbox-container">
                    <input type="checkbox" 
                           id="check_{card_id}" 
                           data-folder="{result['folder']}"
                           data-folder-path="{result['folder_path']}"
                           data-original="{img['original']}"
                           data-preview="{img['preview']}"
                           data-source-path="{img['source_path']}"
                           onchange="toggleSelection(this)">
                    <label for="check_{card_id}">Stack this image</label>
                </div>
            </div>
"""
            
            html_content += """
        </div>
    </div>
"""
        
        # Add buttons and JavaScript
        html_content += """
    <div class="button-container">
        <button class="action-button" id="stackButton" onclick="requestStack()" disabled>
            📚 Stack Selected Images
            <span class="selection-count" id="selectionCount">0</span>
        </button>
    </div>
    
    <div class="lightbox" id="lightbox" onclick="closeLightbox()">
        <span class="lightbox-close">&times;</span>
        <img id="lightbox-img" src="" alt="Full size image">
    </div>
    
    <script>
        let selectedImages = [];
        
        function toggleSelection(checkbox) {
            const folder = checkbox.dataset.folder;
            const folderPath = checkbox.dataset.folderPath;
            const original = checkbox.dataset.original;
            const preview = checkbox.dataset.preview;
            const sourcePath = checkbox.dataset.sourcePath;
            const cardId = checkbox.id.replace('check_', 'card_');
            const card = document.getElementById(cardId);
            
            if (checkbox.checked) {
                card.classList.add('selected');
                selectedImages.push({
                    folder: folder,
                    folder_path: folderPath,
                    original: original,
                    preview: preview,
                    source_path: sourcePath
                });
            } else {
                card.classList.remove('selected');
                selectedImages = selectedImages.filter(
                    img => img.source_path !== sourcePath
                );
            }
            
            updateUI();
        }
        
        function updateUI() {
            const count = selectedImages.length;
            document.getElementById('selectionCount').textContent = count;
            document.getElementById('stackButton').disabled = count < 2;
        }
        
        function requestStack() {
            if (selectedImages.length < 2) {
                showMessage('Please select at least 2 images to stack', 'error');
                return;
            }
            
            // Save selection to JSON for Python to process
            const dataStr = JSON.stringify({
                folder: selectedImages[0].folder,
                images: selectedImages
            }, null, 2);
            
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'stack_request.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showMessage('Stack request saved! Run the Python script in your terminal to process.', 'success');
        }
        
        function showMessage(text, type) {
            const msg = document.getElementById('statusMessage');
            msg.textContent = text;
            msg.className = 'status-message show ' + type;
            setTimeout(() => {
                msg.classList.remove('show');
            }, 5000);
        }
        
        function openLightbox(src) {
            document.getElementById('lightbox').classList.add('active');
            document.getElementById('lightbox-img').src = src;
        }
        
        function closeLightbox() {
            document.getElementById('lightbox').classList.remove('active');
        }
        
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeLightbox();
            }
        });
        
        updateUI();
    </script>
</body>
</html>
"""
        
        with open(html_path, 'w') as f:
            f.write(html_content)
        
        return html_path
    
    def run(self):
        """Main workflow"""
        print("Ask-Marvin Background Stacker")
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
            result = self.process_folder(folder)
            if result:
                all_results.append(result)
        
        # Create HTML viewer
        print("\n" + "="*60)
        print("Creating HTML stacker interface...")
        html_path = self.create_html_viewer(all_results)
        
        print(f"\n{'='*60}")
        print("✅ Processing Complete!")
        print(f"{'='*60}")
        print(f"\nAll files saved to: {self.work_dir}")
        print(f"  - Previews: {self.preview_dir}")
        print(f"  - Stacker interface: {html_path}")
        print(f"\nOpening stacker in browser...")
        print(f"\nNext steps:")
        print(f"  1. Review images in the browser")
        print(f"  2. Check boxes for images you want to stack together")
        print(f"  3. Click 'Stack Selected Images' to save your selection")
        print(f"  4. Selection saved to 'stack_request.json' in Downloads")
        
        # Open in default browser
        os.system(f'open "{html_path}"')
        
        return all_results


if __name__ == "__main__":
    # Everything goes in Image_Processing
    work_dir = "/Users/bcottraven/CyanoVerse/Image_Processing"
    
    stacker = BackgroundStacker(work_dir)
    stacker.run()
