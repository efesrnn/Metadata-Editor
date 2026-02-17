# Metadata Editor

Modern, dark-themed Metadata Editor built with Python and PySide6. Allows viewing and editing metadata for images and media files, with advanced features for managing file dates.

## Features

- **Modern UI**: Dark theme with a clean, responsive layout.
- **File Browser**: Built-in file explorer with filtered view.
- **Preview Panel**: Visual preview for image files (`.jpg`, `.png`, `.webp`, etc.).
- **Metadata Editor**:
  - View detailed metadata (EXIF for images, Tags for audio/video).
  - Edit supported metadata fields.
  - **Date Automation**: 
    - Synchronize "Last Modified Date" with "Creation Date".
    - Edit Creation, Modified, and Accessed dates directly.
    - Windows-specific support for modifying Creation Date.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/efesrnn/Metadata-Editor.git
   cd Metadata-Editor
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

Run the application:
```bash
python main.py
```

### Shortcuts & Tips
- **Select a file**: Click on any file in the left panel to view its preview and metadata.
- **Edit Metadata**: Double-click any value in the Metadata table to edit it.
- **Save**: Click the "Değişiklikleri Kaydet" button to save changes.
- **Automation**: Use the buttons in the "OTOMASYON" section to quickly sync dates.

## Technologies

- **Python 3.x**
- **PySide6** (Qt for Python)
- **Pillow** (Image processing)
- **Mutagen** (Audio/Video metadata)

## License

MIT License
