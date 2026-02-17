import sys
from PySide6.QtWidgets import QApplication
from ui.main_window import MainWindow
from ui.styles import STYLESHEET

if __name__ == "__main__":
    app = QApplication(sys.argv)
    
    # Apply modern custom theme
    app.setStyleSheet(STYLESHEET)

    window = MainWindow()
    window.show()
    sys.exit(app.exec())
