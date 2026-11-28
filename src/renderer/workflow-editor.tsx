import { ArrowRight, Bot as BotIcon, Plus, Terminal, Trash2, UserRound } from 'lucide-react'
import { useRef, useState, type PointerEvent } from 'react'
import { defaultAgentLabel, workflowSchema, type Bot, type Workflow, type WorkflowInput, type WorkflowStep } from '../shared/workflow.ts'
import { workflowCanvasLimit, workflowGraphError, workflowLinks, workflowNodeLimit, type NodePosition } from '../shared/workflow-graph.ts'
import { DialogForm } from './forms.tsx'

type Node = { id: string; step: WorkflowStep; position: NodePosition }
type Link = { from: string; to: string }
type Wire = { from: string; end?: NodePosition }
type Drag = { node: string; pointer: number; point: NodePosition; kind: 'move' | 'link' }
const nodeWidth = 176
const nodeHeight = 72
const clamp = (value: number) => Math.max(12, Math.min(workflowCanvasLimit, value))

function nodeTitle(step: WorkflowStep, bots: Bot[]) {
  if (step.kind === 'human') return step.role || 'Human decision'
  if (step.kind === 'bot') return bots.find((bot) => bot.id === step.botId)?.name ?? 'Unavailable bot'
  return defaultAgentLabel
}

function diagramData(nodes: Node[], links: Link[]) {
  const index = new Map(nodes.map(({ id }, index) => [id, index]))
  return { positions: nodes.map(({ position }) => position), links: links.map(({ from, to }) => ({ from: index.get(from)!, to: index.get(to)! })) }
}

function port(node: Node, output: boolean) {
  return { x: node.position.x + (output ? nodeWidth : 0), y: node.position.y + nodeHeight / 2 }
}

function curve(start: NodePosition, end: NodePosition) {
  const bend = Math.max(42, Math.abs(end.x - start.x) * .48)
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`
}

function WorkflowCanvas({ nodes, links, bots, selected, select, move, connect }: {
  nodes: Node[]; links: Link[]; bots: Bot[]; selected?: string;
  select(id: string): void; move(id: string, position: NodePosition): void; connect(from: string, to: string): void;
}) {
  const canvas = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | undefined>(undefined)
  const [wire, setWire] = useState<Wire>()
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const source = wire && byId.get(wire.from)
  const width = Math.max(640, ...nodes.map(({ position }) => position.x + nodeWidth + 60))
  const height = Math.max(350, ...nodes.map(({ position }) => position.y + nodeHeight + 55))

  function location(event: PointerEvent): NodePosition {
    const bounds = canvas.current!.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }

  function begin(event: PointerEvent<HTMLButtonElement>, node: Node, kind: Drag['kind']) {
    if (event.button !== 0) return
    const at = location(event)
    const point = kind === 'move' ? { x: at.x - node.position.x, y: at.y - node.position.y } : at
    drag.current = { kind, node: node.id, pointer: event.pointerId, point }
    event.currentTarget.setPointerCapture(event.pointerId)
    select(node.id)
    setWire(kind === 'link' ? { from: node.id, end: at } : undefined)
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    const motion = drag.current
    if (!motion || motion.pointer !== event.pointerId) return
    drag.current = undefined
    if (motion.kind !== 'link') return
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-graph-input]')?.dataset.graphInput
    const at = location(event)
    if (target) {
      connect(motion.node, target)
      setWire(undefined)
    } else setWire(Math.hypot(at.x - motion.point.x, at.y - motion.point.y) < 6 ? { from: motion.node } : undefined)
  }

  return <div className="workflow-viewport" role="region" aria-label="Workflow canvas" tabIndex={0}>
    <div className="workflow-canvas" ref={canvas} style={{ width, height }} onPointerUp={end} onPointerCancel={() => {
      drag.current = undefined
      setWire(undefined)
    }} onPointerMove={(event) => {
      const motion = drag.current
      if (!motion || motion.pointer !== event.pointerId) return
      const point = location(event)
      if (motion.kind === 'move') move(motion.node, { x: clamp(point.x - motion.point.x), y: clamp(point.y - motion.point.y) })
      else setWire({ from: motion.node, end: point })
    }} onKeyDown={(event) => {
      if (event.key === 'Escape' && wire) { event.preventDefault(); setWire(undefined) }
    }}>
      <svg className="workflow-wires" width={width} height={height} aria-hidden="true">
        <defs><marker id="workflow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" viewBox="0 0 8 8"><path d="M 0 0 L 8 4 L 0 8 Z" /></marker></defs>
        {links.map(({ from, to }) => {
          const input = port(byId.get(to)!, false)
          return <path key={`${from}:${to}`} className={selected === from || selected === to ? 'connected' : undefined}
            d={curve(port(byId.get(from)!, true), { x: input.x - 7, y: input.y })} markerEnd="url(#workflow-arrow)" />
        })}
        {source && wire?.end && <path className="dragging-wire" d={curve(port(source, true), wire.end)} />}
      </svg>
      {nodes.length === 0 && <p className="workflow-canvas-empty muted">Use + to add a node.</p>}
      {nodes.map((node) => {
        const label = nodeTitle(node.step, bots)
        const Icon = node.step.kind === 'human' ? UserRound : node.step.kind === 'bot' ? BotIcon : Terminal
        return <div key={node.id} className={`workflow-node ${node.step.kind}${selected === node.id ? ' selected' : ''}`} style={{ left: node.position.x, top: node.position.y, width: nodeWidth, height: nodeHeight }}>
          <button className="workflow-node-body" type="button" aria-pressed={selected === node.id} onPointerDown={(event) => begin(event, node, 'move')} onClick={() => select(node.id)}>
            <Icon size={19} /><span><strong title={label}>{label}</strong><small>{node.step.kind === 'human' ? 'Human decision' : 'Coding agent'}</small></span>
          </button>
          <button className="workflow-port input" type="button" data-graph-input={node.id} aria-label={`Input to ${label}`} title="Input" onClick={() => {
            if (source) { connect(source.id, node.id); setWire(undefined) }
          }} />
          <button className={`workflow-port output${source?.id === node.id ? ' armed' : ''}`} type="button" aria-label={`Output from ${label}`} title="Output" onPointerDown={(event) => begin(event, node, 'link')} onClick={(event) => {
            if (event.detail === 0) setWire({ from: node.id })
          }} />
        </div>
      })}
    </div>
  </div>
}

export function WorkflowEditor({ workflow, bots, close, save }: { workflow?: Workflow; bots: Bot[]; close(): void; save(input: WorkflowInput): Promise<void> }) {
  const [name, setName] = useState(workflow?.name ?? '')
  const [nodes, setNodes] = useState<Node[]>(() => workflow?.steps.map((step, index) => ({
    id: crypto.randomUUID(), step, position: workflow.graph?.positions[index] ?? { x: 26 + index * 215, y: 75 },
  })) ?? [])
  const [links, setLinks] = useState<Link[]>(() => workflowLinks(nodes.length, workflow?.graph).map(({ from, to }) => ({ from: nodes[from].id, to: nodes[to].id })))
  const [selected, setSelected] = useState<string | undefined>(nodes[0]?.id)
  const [linkError, setLinkError] = useState('')
  const picker = useRef<HTMLDetailsElement>(null)
  const current = nodes.find(({ id }) => id === selected)

  function add(step: WorkflowStep) {
    const positions = Array.from({ length: workflowNodeLimit * 4 }, (_, index) => ({ x: 26 + (index % 3) * 212, y: 46 + Math.floor(index / 3) * 111 }))
    const position = positions.find((point) => nodes.every(({ position }) =>
      Math.abs(point.x - position.x) >= nodeWidth + 12 || Math.abs(point.y - position.y) >= nodeHeight + 12)) ?? positions[0]
    const id = crypto.randomUUID()
    setNodes((previous) => [...previous, { id, step, position }])
    setSelected(id)
    if (picker.current) picker.current.open = false
  }

  function connect(from: string, to: string) {
    const updated = [...links, { from, to }]
    const error = workflowGraphError(nodes.length, diagramData(nodes, updated).links)
    setLinkError(error ?? '')
    if (!error) setLinks(updated)
  }

  return <DialogForm title={workflow ? 'Edit workflow' : 'New workflow'} className="workflow-dialog" action="Save workflow" close={close} submit={async () => {
    const parsed = workflowSchema.safeParse({ name, steps: nodes.map(({ step }) => step), graph: diagramData(nodes, links) })
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const index = issue.path[1]
      if (issue.path[0] === 'steps' && typeof index === 'number') {
        setSelected(nodes[index]?.id)
        throw new Error('Complete the required fields on the selected node.')
      }
      throw new Error(issue.message)
    }
    await save(parsed.data)
  }}>
    <label>Workflow name<input value={name} required maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Review and approval" /></label>
    <div className="workflow-toolbar">
      <details className="step-picker" ref={picker} onKeyDown={(event) => {
        if (event.key === 'Escape' && event.currentTarget.open) { event.preventDefault(); event.currentTarget.open = false }
      }}>
        <summary className="button secondary" aria-label="Add node" title="Add node"><Plus size={18} /></summary>
        <div className="step-options">
          <button type="button" disabled={nodes.length >= workflowNodeLimit} onClick={() => add({ kind: 'codex', instructions: '' })}><Terminal size={16} /> {defaultAgentLabel}</button>
          {bots.map((bot) => <button key={bot.id} type="button" disabled={nodes.length >= workflowNodeLimit} onClick={() => add({ kind: 'bot', botId: bot.id, instructions: '' })}><BotIcon size={16} /> {bot.name}</button>)}
          <button type="button" disabled={nodes.length >= workflowNodeLimit} onClick={() => add({ kind: 'human', role: '', instructions: '' })}><UserRound size={16} /> Human decision</button>
        </div>
      </details>
      <p className="muted">Drag an output to an input. Ready nodes run in parallel, and a join waits for every input.</p>
    </div>
    {linkError && <p className="form-error" role="alert">{linkError}</p>}
    <div className="workflow-layout">
      <WorkflowCanvas nodes={nodes} links={links} bots={bots} selected={selected} select={setSelected} connect={connect}
        move={(id, position) => setNodes((previous) => previous.map((node) => node.id === id ? { ...node, position } : node))} />
      <aside className="workflow-inspector" aria-label="Node settings">
        {current ? <NodeSettings key={current.id} node={current} nodes={nodes} links={links} bots={bots}
          edit={(step) => setNodes((previous) => previous.map((node) => node.id === current.id ? { ...node, step } : node))}
          disconnect={(link) => { setLinks((previous) => previous.filter((item) => item !== link)); setLinkError('') }}
          remove={() => {
            setNodes((previous) => previous.filter((node) => node.id !== current.id))
            setLinks((previous) => previous.filter(({ from, to }) => from !== current.id && to !== current.id))
            setSelected(nodes.find((node) => node.id !== current.id)?.id)
            setLinkError('')
          }} /> : <p className="muted">Select a node to edit its settings.</p>}
      </aside>
    </div>
  </DialogForm>
}

function NodeSettings({ node, nodes, links, bots, edit, disconnect, remove }: {
  node: Node; nodes: Node[]; links: Link[]; bots: Bot[];
  edit(step: WorkflowStep): void; disconnect(link: Link): void; remove(): void;
}) {
  const { step } = node
  const title = nodeTitle(step, bots)
  const connections = links.filter(({ from, to }) => from === node.id || to === node.id)
  return <>
    <div className="workflow-inspector-heading"><h3>{title}</h3><button className="icon-button" type="button" aria-label="Remove node" title="Remove node" onClick={remove}><Trash2 size={16} /></button></div>
    {step.kind === 'bot' && <label>Bot<select value={step.botId} required onChange={(event) => edit({ ...step, botId: event.target.value })}>{bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>}
    {step.kind === 'human' && <label>Human role<input value={step.role} required maxLength={100} placeholder="Reviewer" onChange={(event) => edit({ ...step, role: event.target.value })} /></label>}
    <label>{step.kind === 'human' ? 'Decision instructions' : 'Instructions (optional)'}<textarea value={step.instructions} rows={4} maxLength={12000} required={step.kind === 'human'} onChange={(event) => edit({ ...step, instructions: event.target.value })} /></label>
    {connections.length > 0 && <ul className="workflow-link-list" aria-label="Connections">{connections.map((link) => {
      const incoming = link.to === node.id
      const peer = nodes.find(({ id }) => id === (incoming ? link.from : link.to))!
      const label = nodeTitle(peer.step, bots)
      return <li key={`${link.from}:${link.to}`}><ArrowRight size={14} /><span>{incoming ? 'From' : 'To'} {label}</span><button className="icon-button" type="button" aria-label={`Remove connection ${incoming ? 'from' : 'to'} ${label}`} title="Remove connection" onClick={() => disconnect(link)}><Trash2 size={14} /></button></li>
    })}</ul>}
  </>
}
