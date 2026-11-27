import { LoaderCircle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TaskFilePreview } from '../shared/workflow.ts'
import { errorMessage } from './forms.tsx'

type State = { status: 'loading' } | { status: 'ready'; preview: TaskFilePreview } | { status: 'error'; message: string }

export function FilePreviewPane({ taskId, path, close }: { taskId: string; path: string; close(): void }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  useEffect(() => {
    let active = true
    void window.meshwork.previewTaskFile(taskId, path).then((preview) => {
      if (active) setState({ status: 'ready', preview })
    }, (error) => {
      if (active) setState({ status: 'error', message: errorMessage(error) })
    })
    return () => { active = false }
  }, [taskId, path])

  const filename = path.split(/[/\\]/).at(-1) || path
  return <aside className="file-preview" id="task-file-preview" aria-labelledby="file-preview-title">
    <header className="file-preview-header">
      <div><h2 id="file-preview-title">{filename}</h2>{filename !== path && <code title={path}>{path}</code>}</div>
      <button type="button" className="icon-button" aria-label="Close file preview" title="Close file preview" onClick={close}><X size={18} /></button>
    </header>
    <div className="file-preview-content">
      {state.status === 'loading' && <p className="file-preview-status muted" role="status"><LoaderCircle className="spin" size={16} /> Loading preview…</p>}
      {state.status === 'error' && <p className="file-preview-status" role="alert">{state.message}</p>}
      {state.status === 'ready' && (state.preview.kind === 'image'
        ? <img src={state.preview.source} alt={filename} onError={() => setState({ status: 'error', message: 'This image could not be displayed.' })} />
        : <>{state.preview.truncated && <p className="file-preview-status muted">Showing the beginning of this file.</p>}
          {state.preview.text ? <pre>{state.preview.text}</pre> : <p className="file-preview-status muted">This file is empty.</p>}</>)}
    </div>
  </aside>
}
