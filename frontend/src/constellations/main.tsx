import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ConstellationStudio from './ConstellationStudio'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConstellationStudio />
  </StrictMode>,
)
