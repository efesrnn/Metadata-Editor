
# Modern Dark Theme Palette
COLORS = {
    "background": "#1e1e1e",
    "surface": "#252526",
    "surface_light": "#2d2d30",
    "primary": "#007acc",
    "primary_hover": "#0098ff",
    "text": "#cccccc",
    "text_bright": "#ffffff",
    "border": "#3e3e42",
    "selection": "#094771",
    "danger": "#f44336"
}

STYLESHEET = f"""
QMainWindow {{
    background-color: {COLORS['background']};
    color: {COLORS['text']};
}}

QWidget {{
    font-family: 'Segoe UI', 'Roboto', sans-serif;
    font-size: 14px;
    color: {COLORS['text']};
}}

/* --- Splitter --- */
QSplitter::handle {{
    background-color: {COLORS['surface']};
    border: 1px solid {COLORS['background']};
}}

QSplitter::handle:hover {{
    background-color: {COLORS['primary']};
}}

/* --- Tree View --- */
QTreeView {{
    background-color: {COLORS['surface']};
    border: none;
    outline: none;
}}

QTreeView::item {{
    padding: 5px;
}}

QTreeView::item:hover {{
    background-color: {COLORS['surface_light']};
}}

QTreeView::item:selected {{
    background-color: {COLORS['selection']};
    color: {COLORS['text_bright']};
}}

QHeaderView::section {{
    background-color: {COLORS['background']};
    color: {COLORS['text']};
    border: none;
    border-bottom: 2px solid {COLORS['border']};
    padding: 5px;
    font-weight: bold;
}}

/* --- Buttons --- */
QPushButton {{
    background-color: {COLORS['primary']};
    color: {COLORS['text_bright']};
    border: none;
    border-radius: 4px;
    padding: 8px 16px;
    font-weight: bold;
}}

QPushButton:hover {{
    background-color: {COLORS['primary_hover']};
}}

QPushButton:pressed {{
    background-color: {COLORS['selection']};
}}

/* --- Labels & Inputs --- */
QLabel {{
    color: {COLORS['text']};
}}

QLineEdit, QTextEdit, QPlainTextEdit {{
    background-color: {COLORS['surface_light']};
    border: 1px solid {COLORS['border']};
    border-radius: 4px;
    padding: 4px;
    color: {COLORS['text_bright']};
    font-size: 14px; /* Ensure font size doesn't shrink when editing in table */
}}

QLineEdit:focus {{
    border: 1px solid {COLORS['primary']};
}}

/* --- Scrollbars (Modern Thin Look) --- */
QScrollBar:vertical {{
    border: none;
    background: {COLORS['background']};
    width: 10px;
    margin: 0px 0px 0px 0px;
}}

QScrollBar::handle:vertical {{
    background: {COLORS['border']};
    min-height: 20px;
    border-radius: 5px;
}}

QScrollBar::handle:vertical:hover {{
    background: {COLORS['primary']};
}}

QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
    height: 0px;
}}

QScrollBar:horizontal {{
    border: none;
    background: {COLORS['background']};
    height: 10px;
    margin: 0px 0px 0px 0px;
}}

QScrollBar::handle:horizontal {{
    background: {COLORS['border']};
    min-width: 20px;
    border-radius: 5px;
}}

QScrollBar::handle:horizontal:hover {{
    background: {COLORS['primary']};
}}

QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{
    width: 0px;
}}
"""
