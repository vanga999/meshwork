import { z } from 'zod'

export const workflowNodeLimit = 20
export const workflowCanvasLimit = 4800
const positionSchema = z.object({ x: z.number().min(0).max(workflowCanvasLimit), y: z.number().min(0).max(workflowCanvasLimit) })
const linkSchema = z.object({ from: z.number().int().min(0), to: z.number().int().min(0) })
export const workflowGraphSchema = z.object({
  positions: z.array(positionSchema).max(workflowNodeLimit),
  links: z.array(linkSchema).max(workflowNodeLimit * (workflowNodeLimit - 1) / 2),
})

export type NodePosition = z.infer<typeof positionSchema>
export type WorkflowLink = z.infer<typeof linkSchema>
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>

export function workflowLinks(count: number, graph?: WorkflowGraph): WorkflowLink[] {
  return graph?.links ?? Array.from({ length: Math.max(0, count - 1) }, (_, from) => ({ from, to: from + 1 }))
}

export function workflowDependencies(count: number, links: WorkflowLink[]) {
  const dependencies = Array.from({ length: count }, (): number[] => [])
  for (const { from, to } of links) dependencies[to].push(from)
  return dependencies
}

export function workflowGraphError(count: number, links: WorkflowLink[]) {
  const seen = new Set<string>()
  for (const { from, to } of links) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= count || to < 0 || to >= count) return 'Every connection must link two nodes in this workflow.'
    if (from === to) return 'A node cannot connect to itself.'
    const key = `${from}:${to}`
    if (seen.has(key)) return 'These nodes are already connected in this direction.'
    seen.add(key)
  }

  const dependencies = workflowDependencies(count, links)
  const processed = new Set<number>()
  for (;;) {
    const before = processed.size
    dependencies.forEach((upstream, index) => {
      if (upstream.every((step) => processed.has(step))) processed.add(index)
    })
    if (processed.size === count) return undefined
    if (processed.size === before) return 'This connection creates a cycle.'
  }
}

export function workflowAncestors(step: number, dependencies: number[][]) {
  const ancestors = new Set<number>()
  const visit = (index: number) => {
    for (const upstream of dependencies[index]) {
      if (ancestors.has(upstream)) continue
      ancestors.add(upstream)
      visit(upstream)
    }
  }
  visit(step)
  return ancestors
}
