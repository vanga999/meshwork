import { contextBridge, ipcRenderer } from 'electron'
import { channels } from '../shared/channels.ts'
import type { DesktopApi } from '../shared/workflow.ts'

const api: DesktopApi = {
  load: () => ipcRenderer.invoke(channels.load),
  saveBot: (input, id) => ipcRenderer.invoke(channels.saveBot, input, id),
  saveProject: (input, id) => ipcRenderer.invoke(channels.saveProject, input, id),
  startTask: (input) => ipcRenderer.invoke(channels.startTask, input),
  cancelTask: (id) => ipcRenderer.invoke(channels.cancelTask, id),
  retryTask: (id) => ipcRenderer.invoke(channels.retryTask, id),
  completeHumanStep: (id, accepted, note) => ipcRenderer.invoke(channels.completeHumanStep, id, accepted, note),
  answerApproval: (taskId, approvalId, accepted) => ipcRenderer.invoke(channels.answerApproval, taskId, approvalId, accepted),
  chooseWorkspace: () => ipcRenderer.invoke(channels.chooseWorkspace),
  chooseCodex: () => ipcRenderer.invoke(channels.chooseCodex),
  resetCodex: () => ipcRenderer.invoke(channels.resetCodex),
  subscribe(listener) {
    const callback = () => listener()
    ipcRenderer.on(channels.changed, callback)
    return () => ipcRenderer.removeListener(channels.changed, callback)
  },
}

contextBridge.exposeInMainWorld('meshwork', api)
