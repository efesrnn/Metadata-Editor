import sys
from PySide6.QtWidgets import QApplication
from qt_material import apply_stylesheet
from ui.main_window import MainWindow

if __name__ == "__main__":
    app = QApplication(sys.argv)
    
    # Apply modern theme
    # 'dark_teal.xml', 'dark_cyan.xml', 'light_blue.xml', etc.
    try:
        apply_stylesheet(app, theme='dark_teal.xml')
    except Exception as e:
        print(f"Theme Error: {e}")

    window = MainWindow()
    window.show()
    sys.exit(app.exec())
