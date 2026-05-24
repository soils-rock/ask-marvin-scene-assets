#!/usr/bin/env python3
"""
Ask-Marvin Background Image Viewer
Converts CR2 files to PNG and creates an HTML viewer for comparison with selection
"""

import os
import rawpy
import numpy as np
from PIL import Image
from pathlib import Path
import json

class BackgroundViewer:
    def __init__(self, work_dir):
        self.work_dir = Path(work_dir)
        
        # Source files on external drive
        self.base_path = Path("/Volumes/Marvin/CyanoVerse_Source_Files")
        self.backgrounds_raw = self.base_path / "Backgrounds_Raw"
        
        # Everything goes in work_dir
        self.preview_dir = self.work_dir / "backgrounds" / "previews"
        self.preview_dir.mkdir(parents=True, exist_ok=True)
        
        self.selections_file = self.work_dir / "backgrounds" / "selected_images.json"
        
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
    
    def create_html_viewer(self, all_results):
        """Create an HTML file for viewing images side-by-side with selection"""
        html_path = self.work_dir / "backgrounds" / "viewer.html"
        
        # Create the absolute path for the selections file that JavaScript will use
        selections_file_abs = str(self.selections_file.absolute())
        
        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ask-Marvin Background Image Viewer</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: #1a1a1a;
            color: #e0e0e0;
            padding: 20px;
        }}
        
        h1 {{
            text-align: center;
            margin-bottom: 30px;
            color: #4a9eff;
        }}
        
        .folder-section {{
            margin-bottom: 50px;
            background: #2a2a2a;
            border-radius: 10px;
            padding: 20px;
        }}
        
        .folder-title {{
            font-size: 24px;
            margin-bottom: 20px;
            color: #66d9ef;
            border-bottom: 2px solid #444;
            padding-bottom: 10px;
        }}
        
        .image-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }}
        
        .image-card {{
            background: #333;
            border-radius: 8px;
            padding: 15px;
            transition: all 0.2s;
            position: relative;
        }}
        
        .image-card:hover {{
            transform: scale(1.02);
            box-shadow: 0 4px 20px rgba(74, 158, 255, 0.3);
        }}
        
        .image-card.selected {{
            border: 3px solid #4a9eff;
            background: #3a3a3a;
        }}
        
        .image-card img {{
            width: 100%;
            height: auto;
            border-radius: 5px;
            cursor: pointer;
        }}
        
        .image-label {{
            text-align: center;
            margin-top: 10px;
            font-size: 14px;
            color: #a0a0a0;
        }}
        
        .image-filename {{
            font-family: 'Courier New', monospace;
            color: #f92672;
            font-weight: bold;
        }}
        
        .checkbox-container {{
            display: flex;
            align-items: center;
            justify-content: center;
            margin-top: 10px;
            gap: 8px;
        }}
        
        .checkbox-container input[type="checkbox"] {{
            width: 20px;
            height: 20px;
            cursor: pointer;
        }}
        
        .checkbox-container label {{
            cursor: pointer;
            font-weight: bold;
            color: #4a9eff;
        }}
        
        .lightbox {{
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
        }}
        
        .lightbox.active {{
            display: flex;
        }}
        
        .lightbox img {{
            max-width: 95%;
            max-height: 95%;
            object-fit: contain;
        }}
        
        .lightbox-close {{
            position: absolute;
            top: 20px;
            right: 40px;
            font-size: 40px;
            color: white;
            cursor: pointer;
            font-weight: bold;
        }}
        
        .instructions {{
            background: #2a4a2a;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 30px;
            border-left: 4px solid #4a9eff;
        }}
        
        .instructions h2 {{
            margin-bottom: 10px;
            color: #66d9ef;
        }}
        
        .instructions ul {{
            margin-left: 20px;
        }}
        
        .instructions li {{
            margin: 5px 0;
        }}
        
        .instructions code {{
            background: #1a1a1a;
            padding: 2px 6px;
            border-radius: 3px;
            color: #f92672;
        }}
        
        .save-button-container {{
            position: fixed;
            bottom: 30px;
            right: 30px;
            z-index: 100;
        }}
        
        .save-button {{
            background: #4a9eff;
            color: white;
            border: none;
            padding: 15px 30px;
            font-size: 16px;
            font-weight: bold;
            border-radius: 8px;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(74, 158, 255, 0.4);
            transition: all 0.2s;
        }}
        
        .save-button:hover {{
            background: #66b3ff;
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(74, 158, 255, 0.6);
        }}
        
        .save-button:active {{
            transform: translateY(0);
        }}
        
        .selection-count {{
            background: #f92672;
            color: white;
            border-radius: 50%;
            padding: 5px 10px;
            font-size: 14px;
            position: absolute;
            top: -10px;
            right: -10px;
            min-width: 25px;
            text-align: center;
        }}
        
        .status-message {{
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
        }}
        
        .status-message.show {{
            display: block;
            animation: slideIn 0.3s ease-out;
        }}
        
        .status-message.success {{
            background: #66d966;
        }}
        
        @keyframes slideIn {{
            from {{
                transform: translateX(400px);
                opacity: 0;
            }}
            to {{
                transform: translateX(0);
                opacity: 1;
            }}
        }}
    </style>
</head>
<body>
    <h1>🖼️ Ask-Marvin Background Image Viewer</h1>
    
    <div class="instructions">
        <h2>Instructions:</h2>
        <ul>
            <li>Click any image to view it full-size</li>
            <li>Check the box below images you want to keep</li>
            <li>Click "Save Selection" when done</li>
            <li>Your selections will be saved to: <code>{self.selections_file}</code></li>
        </ul>
    </div>
    
    <div class="status-message" id="statusMessage">Selection saved!</div>
"""
        
        # Add each folder section with data attributes
        for result in all_results:
            if result is None:
                continue
                
            html_content += f"""
    <div class="folder-section">
        <div class="folder-title">📁 {result['folder']}</div>
        <div class="image-grid">
"""
            
            for idx, img in enumerate(result['images']):
                rel_path = f"previews/{img['preview']}"
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
                    <label for="check_{card_id}">Keep this image</label>
                </div>
            </div>
"""
            
            html_content += """
        </div>
    </div>
"""
        
        # Close HTML and add JavaScript
        html_content += f"""
    <div class="save-button-container">
        <button class="save-button" onclick="saveSelection()">
            💾 Save Selection
            <span class="selection-count" id="selectionCount">0</span>
        </button>
    </div>
    
    <div class="lightbox" id="lightbox" onclick="closeLightbox()">
        <span class="lightbox-close">&times;</span>
        <img id="lightbox-img" src="" alt="Full size image">
    </div>
    
    <script>
        let selectedImages = {{}};
        const selectionsFile = '{selections_file_abs}';
        
        // Load existing selections if any
        window.addEventListener('DOMContentLoaded', function() {{
            loadSelections();
        }});
        
        function loadSelections() {{
            // Try to load from localStorage
            const saved = localStorage.getItem('askMarvinSelections');
            if (saved) {{
                try {{
                    selectedImages = JSON.parse(saved);
                    restoreCheckboxes();
                    updateSelectionCount();
                }} catch (e) {{
                    console.error('Error loading selections:', e);
                }}
            }}
        }}
        
        function restoreCheckboxes() {{
            // Restore checkbox states from loaded selections
            for (let folder in selectedImages) {{
                selectedImages[folder].forEach(img => {{
                    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
                    checkboxes.forEach(cb => {{
                        if (cb.dataset.folder === folder && cb.dataset.original === img.original) {{
                            cb.checked = true;
                            const cardId = cb.id.replace('check_', 'card_');
                            document.getElementById(cardId).classList.add('selected');
                        }}
                    }});
                }});
            }}
        }}
        
        function toggleSelection(checkbox) {{
            const folder = checkbox.dataset.folder;
            const folderPath = checkbox.dataset.folderPath;
            const original = checkbox.dataset.original;
            const preview = checkbox.dataset.preview;
            const sourcePath = checkbox.dataset.sourcePath;
            const cardId = checkbox.id.replace('check_', 'card_');
            const card = document.getElementById(cardId);
            
            if (checkbox.checked) {{
                card.classList.add('selected');
                if (!selectedImages[folder]) {{
                    selectedImages[folder] = [];
                }}
                selectedImages[folder].push({{
                    original: original,
                    preview: preview,
                    source_path: sourcePath,
                    folder_path: folderPath
                }});
            }} else {{
                card.classList.remove('selected');
                if (selectedImages[folder]) {{
                    selectedImages[folder] = selectedImages[folder].filter(
                        img => img.original !== original
                    );
                    if (selectedImages[folder].length === 0) {{
                        delete selectedImages[folder];
                    }}
                }}
            }}
            
            // Save to localStorage immediately
            localStorage.setItem('askMarvinSelections', JSON.stringify(selectedImages));
            updateSelectionCount();
        }}
        
        function updateSelectionCount() {{
            let count = 0;
            for (let folder in selectedImages) {{
                count += selectedImages[folder].length;
            }}
            document.getElementById('selectionCount').textContent = count;
        }}
        
        function saveSelection() {{
            // Save as downloadable JSON
            const dataStr = JSON.stringify(selectedImages, null, 2);
            const blob = new Blob([dataStr], {{ type: 'application/json' }});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'selected_images.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            // Show status message
            const statusMsg = document.getElementById('statusMessage');
            statusMsg.textContent = 'Selection saved to selected_images.json in your Downloads!';
            statusMsg.classList.add('show', 'success');
            setTimeout(() => {{
                statusMsg.classList.remove('show');
            }}, 4000);
            
            console.log('Selected images:', selectedImages);
            console.log('File should be saved to:', selectionsFile);
        }}
        
        function openLightbox(src) {{
            document.getElementById('lightbox').classList.add('active');
            document.getElementById('lightbox-img').src = src;
        }}
        
        function closeLightbox() {{
            document.getElementById('lightbox').classList.remove('active');
        }}
        
        // Close on Escape key
        document.addEventListener('keydown', function(e) {{
            if (e.key === 'Escape') {{
                closeLightbox();
            }}
        }});
        
        // Initialize selection count
        updateSelectionCount();
    </script>
</body>
</html>
"""
        
        with open(html_path, 'w') as f:
            f.write(html_content)
        
        return html_path
    
    def run(self):
        """Main workflow"""
        print("Ask-Marvin Background Image Viewer")
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
        print("Creating HTML viewer...")
        html_path = self.create_html_viewer(all_results)
        
        print(f"\n{'='*60}")
        print("✅ Processing Complete!")
        print(f"{'='*60}")
        print(f"\nAll files saved to: {self.work_dir}")
        print(f"  - Previews: {self.preview_dir}")
        print(f"  - Viewer: {html_path}")
        print(f"  - Selections will be saved to: {self.selections_file}")
        print(f"\nOpening viewer in browser...")
        
        # Open in default browser
        os.system(f'open "{html_path}"')
        
        return all_results


if __name__ == "__main__":
    # Everything goes in Image_Processing
    work_dir = "/Users/bcottraven/CyanoVerse/Image_Processing"
    
    viewer = BackgroundViewer(work_dir)
    viewer.run()
