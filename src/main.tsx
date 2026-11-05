import { lazy, Suspense, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const Annotator = lazy(() => import('./AnnotationWorkspace'))
const annotationMode = new URLSearchParams(window.location.search).get('annotate') === '1' || new URLSearchParams(window.location.search).get('review') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {annotationMode ? <Suspense fallback={<p>Loading annotator…</p>}><Annotator /></Suspense> : <App />}
  </StrictMode>,
)
