export const channels = {
  load: 'meshwork:load',
  saveBot: 'meshwork:save-bot',
  saveProject: 'meshwork:save-project',
  startTask: 'meshwork:start-task',
  cancelTask: 'meshwork:cancel-task',
  retryTask: 'meshwork:retry-task',
  completeHumanStep: 'meshwork:complete-human-step',
  answerApproval: 'meshwork:answer-approval',
  chooseWorkspace: 'meshwork:choose-workspace',
  chooseCodex: 'meshwork:choose-codex',
  resetCodex: 'meshwork:reset-codex',
  changed: 'meshwork:changed',
} as const
