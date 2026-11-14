import { DevEnvironment, XRiftProvider } from '@xrift/world-components'
import type { CameraConfig, PhysicsConfig } from '@xrift/world-components'
import type { TextInputContextValue } from '@xrift/world-components'
import { createRoot } from 'react-dom/client'
import { World } from './World'
import xriftConfig from '../xrift.json'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

const worldConfig = xriftConfig.world as unknown as {
  physics?: PhysicsConfig
  camera?: CameraConfig & { position?: [number, number, number]; fov?: number }
}

const devTextInput: TextInputContextValue = {
  isActive: false,
  requestTextInput: (request) => {
    const value = window.prompt(request.placeholder ?? 'テキストを入力してください', request.initialValue ?? '')
    if (value === null) {
      request.onCancel?.()
      return
    }
    request.onSubmit(value.slice(0, request.maxLength ?? value.length))
  },
}

createRoot(rootElement).render(
  <XRiftProvider baseUrl="/" textInputImplementation={devTextInput}>
    <DevEnvironment
      physicsConfig={worldConfig.physics}
      camera={worldConfig.camera}
      spawnPosition={[0, 0, 3.8]}
    >
      <World />
    </DevEnvironment>
  </XRiftProvider>,
)
