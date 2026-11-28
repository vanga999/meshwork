import { z } from 'zod'
import { resultSchema } from '../shared/workflow.ts'
import type { Execution } from './workflow-engine.ts'

export const agentResultSchema = z.toJSONSchema(resultSchema, { target: 'draft-7' })

export function agentPrompt(execution: Execution) {
  return [
    `You are executing the ${execution.step.role} step of a Meshwork workflow.`,
    `Task objective:\n${execution.objective}`,
    `Your responsibilities and completion criteria:\n${execution.step.instructions}`,
    `Previous step results (context for this step):\n${JSON.stringify(execution.handoffs)}`,
    ...(execution.followUp ? [`Latest user follow-up for this task:\n${execution.followUp.text}`] : []),
    'Return an accurate summary, details including any checks and limitations, and an array of relevant file paths relative to the workspace. Use an empty array if there are no files.',
  ].join('\n\n')
}
