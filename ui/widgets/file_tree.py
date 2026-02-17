from PySide6.QtWidgets import QTreeView, QFileSystemModel, QStyledItemDelegate
from PySide6.QtCore import QDir
from ui.styles import COLORS

class FileTree(QTreeView):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAlternatingRowColors(False)
        self.setRootIsDecorated(True)
        self.setUniformRowHeights(True)
        
        # Setup File System Model
        self.file_model = QFileSystemModel()
        self.file_model.setRootPath(QDir.rootPath())
        self.file_model.setFilter(QDir.NoDotAndDotDot | QDir.AllDirs | QDir.Files)
        
        self.setModel(self.file_model)
        self.setRootIndex(self.file_model.index(QDir.homePath()))
        
        # UI Optimizations
        self.setAnimated(True)
        self.setIndentation(20)
        self.setSortingEnabled(True)
        
        # Hide unnecessary columns (Size, Type, Date)
        for i in range(1, 4):
            self.hideColumn(i)
            
        # Optional: Custom Column Width
        self.setColumnWidth(0, 300)
        
    def get_selected_path(self):
        indexes = self.selectionModel().selectedIndexes()
        if indexes:
            return self.file_model.filePath(indexes[0])
        return None
