// Standalone preview of the star-collision intro (frontend/intro.html).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import StarCollision from './StarCollision'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StarCollision onDone={() => { location.href = '/' }} />
  </StrictMode>,
)
