const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadProject: () => ipcRenderer.invoke('project:load'),
  saveProject: (data) => ipcRenderer.invoke('project:save', data),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProjectAs: (data) => ipcRenderer.invoke('project:saveAs', data),
  pickXlsx: () => ipcRenderer.invoke('xlsx:pick'),
  importXlsx: (file, sheet) => ipcRenderer.invoke('xlsx:import', file, sheet),
  exportDocx: (payload, name) => ipcRenderer.invoke('docx:export', payload, name),
  openPath: (file) => ipcRenderer.invoke('shell:open', file),
  showInFolder: (file) => ipcRenderer.invoke('shell:show', file),
});
