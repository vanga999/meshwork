import { contextBridge, ipcRenderer } from 'electron'
import { channels } from '../shared/channels.ts'
import type { DesktopApi } from '../shared/workflow.ts'

const api: DesktopApi = {
  load: () => ipcRenderer.invoke(channels.load),
  saveBot: (input, id) => ipcRenderer.invoke(channels.saveBot, input, id),
  saveWorkflow: (input, id) => ipcRenderer.invoke(channels.saveWorkflow, input, id),
  saveProject: (input, id) => ipcRenderer.invoke(channels.saveProject, input, id),
  startTask: (input) => ipcRenderer.invoke(channels.startTask, input),
  sendFollowUp: (id, text) => ipcRenderer.invoke(channels.sendFollowUp, id, text),
  completeTask: (id) => ipcRenderer.invoke(channels.completeTask, id),
  cancelTask: (id) => ipcRenderer.invoke(channels.cancelTask, id),
  deleteTask: (id) => ipcRenderer.invoke(channels.deleteTask, id),
  previewTaskFile: (taskId, path) => ipcRenderer.invoke(channels.previewTaskFile, taskId, path),
  retryTask: (id) => ipcRenderer.invoke(channels.retryTask, id),
  completeHumanStep: (id, accepted, note, stepIndex) => ipcRenderer.invoke(channels.completeHumanStep, id, accepted, note, stepIndex),
  answerApproval: (taskId, approvalId, accepted) => ipcRenderer.invoke(channels.answerApproval, taskId, approvalId, accepted),
  chooseWorkspace: () => ipcRenderer.invoke(channels.chooseWorkspace),
  chooseAgentExecutable: (agent) => ipcRenderer.invoke(channels.chooseAgentExecutable, agent),
  saveAgentProfile: (input, id) => ipcRenderer.invoke(channels.saveAgentProfile, input, id),
  resetAgentExecutable: (agent) => ipcRenderer.invoke(channels.resetAgentExecutable, agent),
  saveAgentConnection: (agent, input) => ipcRenderer.invoke(channels.saveAgentConnection, agent, input),
  setDefaultAgent: (agent) => ipcRenderer.invoke(channels.setDefaultAgent, agent),
  subscribe(listener) {
    const callback = () => listener()
    ipcRenderer.on(channels.changed, callback)
    return () => ipcRenderer.removeListener(channels.changed, callback)
  },
}

contextBridge.exposeInMainWorld('meshwork', api)
