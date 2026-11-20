import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import VDONinjaSDK from '@vdoninja/sdk'
import {
  Interactable,
  Seat,
  SpawnPoint,
  TextInput,
  type SeatControlInput,
  type SeatOccupant,
} from '@xrift/world-components'
import { RigidBody } from '@react-three/rapier'
import { Text } from '@react-three/drei'
import { SRGBColorSpace, VideoTexture, type MeshBasicMaterial } from 'three'

type ReceiverStatus = 'idle' | 'connecting' | 'receiving' | 'error'
type RcConnectionStatus = 'connecting' | 'connected' | 'disconnected'
type MotorDirection = -1 | 0 | 1

interface MotorCommand {
  left: MotorDirection
  right: MotorDirection
}

type ControlSource = 'W' | 'A' | 'S' | 'D' | 'W+A' | 'W+D' | 'S+A' | 'S+D' | 'カーソル' | '停止'

const STOP_COMMAND: MotorCommand = { left: 0, right: 0 }

const DEFAULT_RC_WS_URL = 'wss://rc.ymnbuild.org/ws'

interface VdoViewerConfig {
  streamId: string
  room?: string
  password?: string | false
  signalingHost?: string
}

export interface WorldProps {
  position?: [number, number, number]
  scale?: number
}

export const World: React.FC<WorldProps> = ({ position = [0, 0, 0], scale = 1 }) => (
  <group position={position} scale={scale}>
    <Room />
    <Lighting />
    <VdoNinjaReceiver />
    <RcCarControlPanel />
    <SpawnPoint position={[0, 0, 3.8]} yaw={0} />
  </group>
)

function RcCarControlPanel() {
  const wsUrl = import.meta.env.VITE_RC_WS_URL || DEFAULT_RC_WS_URL
  const socketRef = useRef<WebSocket | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<RcConnectionStatus>('disconnected')
  const [deviceConnected, setDeviceConnected] = useState(false)
  const [seated, setSeated] = useState(false)
  const [motorCommand, setMotorCommand] = useState<MotorCommand>(STOP_COMMAND)
  const [controlSource, setControlSource] = useState<ControlSource>('停止')
  const [error, setError] = useState('')
  const cursorCommandRef = useRef<MotorCommand | null>(null)
  const lastSeatCommandRef = useRef<MotorCommand>(STOP_COMMAND)
  const lastSentCommandRef = useRef<MotorCommand>(STOP_COMMAND)

  const applyCommand = useCallback((command: MotorCommand, source: ControlSource) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setMotorCommand(STOP_COMMAND)
      setControlSource('停止')
      setError('WS未接続')
      return false
    }

    if (sameCommand(command, lastSentCommandRef.current)) {
      setMotorCommand(command)
      setControlSource(source)
      setError('')
      return true
    }

    socket.send(JSON.stringify({ type: 'motor_set', left: command.left, right: command.right }))
    lastSentCommandRef.current = command
    setMotorCommand(command)
    setControlSource(source)
    setError('')
    return true
  }, [])

  const stopMotors = useCallback((source: ControlSource = '停止') => {
    cursorCommandRef.current = null
    lastSeatCommandRef.current = STOP_COMMAND
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN && !sameCommand(lastSentCommandRef.current, STOP_COMMAND)) {
      socket.send(JSON.stringify({ type: 'motor_set', ...STOP_COMMAND }))
    }
    lastSentCommandRef.current = STOP_COMMAND
    setMotorCommand(STOP_COMMAND)
    setControlSource(source)
  }, [])

  useEffect(() => {
    let disposed = false
    const socket = new WebSocket(wsUrl)
    socketRef.current = socket
    setConnectionStatus('connecting')
    setError('')

    socket.onopen = () => {
      if (disposed) return
      setConnectionStatus('connected')
      lastSentCommandRef.current = STOP_COMMAND
      lastSeatCommandRef.current = STOP_COMMAND
      socket.send(JSON.stringify({ type: 'hello', role: 'xrift' }))
    }

    socket.onmessage = (event) => {
      if (disposed || typeof event.data !== 'string') return

      try {
        const message = JSON.parse(event.data) as Record<string, unknown>
        if (message.type === 'device_status' && typeof message.connected === 'boolean') {
          setDeviceConnected(message.connected)
          if (!message.connected) {
            stopMotors()
          }
        }
        if (
          message.type === 'motor_state'
          && isMotorDirection(message.left)
          && isMotorDirection(message.right)
        ) {
          setMotorCommand({ left: message.left, right: message.right })
        }
        if (message.type === 'error' && typeof message.code === 'string') {
          setError(message.code)
        }
      } catch {
        setError('WSメッセージを解釈できません')
      }
    }

    socket.onerror = () => {
      if (!disposed) setError('WS接続エラー')
    }

    socket.onclose = () => {
      if (!disposed) {
        setConnectionStatus('disconnected')
        setDeviceConnected(false)
        stopMotors()
      }
    }

    return () => {
      disposed = true
      stopMotors()
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
      if (socketRef.current === socket) socketRef.current = null
    }
  }, [stopMotors, wsUrl])

  const handleSeatEnter = useCallback((occupant: SeatOccupant) => {
    if (!occupant.isLocalUser) return
    lastSeatCommandRef.current = STOP_COMMAND
    setSeated(true)
    stopMotors()
  }, [stopMotors])

  const handleSeatLeave = useCallback((occupant: SeatOccupant) => {
    if (!occupant.isLocalUser) return
    lastSeatCommandRef.current = STOP_COMMAND
    setSeated(false)
    stopMotors()
  }, [stopMotors])

  const handleSeatControl = useCallback((input: SeatControlInput) => {
    const command = commandFromSeatInput(input)
    const source = sourceFromSeatInput(input)
    if (sameCommand(command, lastSeatCommandRef.current)) return

    lastSeatCommandRef.current = command
    if (!deviceConnected) {
      setMotorCommand(STOP_COMMAND)
      setControlSource('停止')
      return
    }

    if (sameCommand(command, STOP_COMMAND) && cursorCommandRef.current) return
    if (!sameCommand(command, STOP_COMMAND)) cursorCommandRef.current = null
    applyCommand(command, source)
  }, [applyCommand, deviceConnected])

  const setCursorCommand = useCallback((command: MotorCommand) => {
    if (!seated) return
    cursorCommandRef.current = command
    applyCommand(command, 'カーソル')
  }, [applyCommand, seated])

  const connectionLabel = connectionStatus === 'connected'
    ? 'WS接続済み'
    : connectionStatus === 'connecting'
      ? 'WS接続中…'
      : 'WS未接続'

  const commandLabel = describeCommand(motorCommand)
  const leftLabel = describeDirection(motorCommand.left)
  const rightLabel = describeDirection(motorCommand.right)

  return (
    <>
      <Seat
        id="rc-driver-seat"
        position={[0, 0.48, -0.95]}
        exitOffset={{ forward: 0.8, right: 0.8 }}
        interactionText="ラジコン席に座る"
        onEnter={handleSeatEnter}
        onLeave={handleSeatLeave}
        onControlInput={handleSeatControl}
      >
        <group>
          <mesh position={[0, -0.05, 0]} castShadow>
            <boxGeometry args={[1.15, 0.2, 1.05]} />
            <meshStandardMaterial color="#26384a" roughness={0.65} />
          </mesh>
          <mesh position={[0, 0.62, 0.4]} castShadow>
            <boxGeometry args={[1.15, 1.25, 0.18]} />
            <meshStandardMaterial color="#1b2a3a" roughness={0.7} />
          </mesh>
          <mesh position={[-0.42, -0.38, 0]} castShadow>
            <boxGeometry args={[0.12, 0.65, 0.12]} />
            <meshStandardMaterial color="#111722" metalness={0.35} roughness={0.5} />
          </mesh>
          <mesh position={[0.42, -0.38, 0]} castShadow>
            <boxGeometry args={[0.12, 0.65, 0.12]} />
            <meshStandardMaterial color="#111722" metalness={0.35} roughness={0.5} />
          </mesh>
        </group>
      </Seat>

      <group position={[1.65, 1.35, -2.0]} rotation={[0, -0.75, 0]}>
      <mesh position={[0, 0, -0.08]} castShadow>
        <boxGeometry args={[2.65, 2.45, 0.16]} />
        <meshStandardMaterial color="#101722" metalness={0.2} roughness={0.55} />
      </mesh>
      <Text
        position={[0, 0.78, 0.02]}
        fontSize={0.13}
        color="#e3edf8"
        anchorX="center"
        anchorY="middle"
        material-toneMapped={false}
      >
        RC CAR CONTROL
      </Text>
      <Text
        position={[0, 0.59, 0.02]}
        fontSize={0.08}
        color={connectionStatus === 'connected' ? '#7ee0aa' : '#aab9c8'}
        anchorX="center"
        anchorY="middle"
        material-toneMapped={false}
      >
        {connectionLabel}
      </Text>
      <Text
        position={[0, 0.43, 0.02]}
        fontSize={0.08}
        color="#b8c9d8"
        anchorX="center"
        anchorY="middle"
        material-toneMapped={false}
      >
        車体: {deviceConnected ? '接続' : '未接続'}　着席: {seated ? '操作可能' : '座ってください'}
      </Text>
      <Text
        position={[0, 0.23, 0.02]}
        fontSize={0.13}
        color={motorCommand.left === 0 && motorCommand.right === 0 ? '#aab9c8' : '#ffd479'}
        anchorX="center"
        anchorY="middle"
        material-toneMapped={false}
      >
        操作指示：{commandLabel}
      </Text>
      <Text
        position={[0, 0.06, 0.02]}
        fontSize={0.075}
        color="#b8c9d8"
        anchorX="center"
        anchorY="middle"
        material-toneMapped={false}
      >
        左：{leftLabel}　右：{rightLabel}　入力：{controlSource}
      </Text>
      <DriveButton
        id="rc-car-drive-forward"
        label="W"
        position={[0, -0.28, 0.05]}
        enabled={seated && connectionStatus === 'connected' && deviceConnected}
        active={motorCommand.left === 1 && motorCommand.right === 1}
        interactionText="前進"
        onInteract={() => setCursorCommand({ left: 1, right: 1 })}
      />
      <DriveButton
        id="rc-car-drive-left"
        label="A"
        position={[-0.56, -0.68, 0.05]}
        enabled={seated && connectionStatus === 'connected' && deviceConnected}
        active={motorCommand.left === 1 && motorCommand.right === -1}
        interactionText="左旋回"
        onInteract={() => setCursorCommand({ left: 1, right: -1 })}
      />
      <DriveButton
        id="rc-car-drive-back"
        label="S"
        position={[0, -0.68, 0.05]}
        enabled={seated && connectionStatus === 'connected' && deviceConnected}
        active={motorCommand.left === -1 && motorCommand.right === -1}
        interactionText="後退"
        onInteract={() => setCursorCommand({ left: -1, right: -1 })}
      />
      <DriveButton
        id="rc-car-drive-right"
        label="D"
        position={[0.56, -0.68, 0.05]}
        enabled={seated && connectionStatus === 'connected' && deviceConnected}
        active={motorCommand.left === -1 && motorCommand.right === 1}
        interactionText="右旋回"
        onInteract={() => setCursorCommand({ left: -1, right: 1 })}
      />
      <DriveButton
        id="rc-car-drive-stop"
        label="STOP"
        position={[0, -1.02, 0.05]}
        enabled={seated && connectionStatus === 'connected' && deviceConnected}
        active={motorCommand.left === 0 && motorCommand.right === 0}
        interactionText="停止"
        onInteract={() => stopMotors()}
      />
      {error ? (
        <Text
          position={[0, -1.22, 0.02]}
          fontSize={0.065}
          color="#ff8f88"
          anchorX="center"
          anchorY="middle"
          material-toneMapped={false}
        >
          {error}
        </Text>
      ) : null}
      </group>
    </>
  )
}

function DriveButton({
  id,
  label,
  position,
  enabled,
  active,
  interactionText,
  onInteract,
}: {
  id: string
  label: string
  position: [number, number, number]
  enabled: boolean
  active: boolean
  interactionText: string
  onInteract: () => void
}) {
  return (
    <Interactable
      id={id}
      type="button"
      enabled={enabled}
      interactionText={interactionText}
      onInteract={onInteract}
    >
      <group position={position}>
        <mesh>
          <boxGeometry args={[0.42, 0.28, 0.07]} />
          <meshStandardMaterial
            color={active ? '#855d21' : enabled ? '#15546a' : '#242b34'}
            emissive={active ? '#855d21' : enabled ? '#15546a' : '#242b34'}
            emissiveIntensity={active ? 0.45 : 0.16}
          />
        </mesh>
        <Text
          position={[0, 0, 0.05]}
          fontSize={0.105}
          color={enabled ? '#e6f1f8' : '#697584'}
          anchorX="center"
          anchorY="middle"
          material-toneMapped={false}
        >
          {label}
        </Text>
      </group>
    </Interactable>
  )
}

function isMotorDirection(value: unknown): value is MotorDirection {
  return value === -1 || value === 0 || value === 1
}

function sameCommand(left: MotorCommand, right: MotorCommand) {
  return left.left === right.left && left.right === right.right
}

function commandFromSeatInput(input: SeatControlInput): MotorCommand {
  const forward = input.forward > 0.25 ? 1 : input.forward < -0.25 ? -1 : 0
  const right = input.right > 0.25 ? 1 : input.right < -0.25 ? -1 : 0
  return {
    left: directionValue(forward - right),
    right: directionValue(forward + right),
  }
}

function sourceFromSeatInput(input: SeatControlInput): ControlSource {
  const forward = input.forward > 0.25 ? 'W' : input.forward < -0.25 ? 'S' : ''
  const right = input.right > 0.25 ? 'D' : input.right < -0.25 ? 'A' : ''
  if (forward && right) return `${forward}+${right}` as ControlSource
  if (forward) return forward as ControlSource
  if (right) return right as ControlSource
  return '停止'
}

function directionValue(value: number): MotorDirection {
  return value > 0 ? 1 : value < 0 ? -1 : 0
}

function describeDirection(value: MotorDirection) {
  return value === 1 ? '前進' : value === -1 ? '後退' : '停止'
}

function describeCommand(command: MotorCommand) {
  if (command.left === 0 && command.right === 0) return '停止'
  if (command.left === 1 && command.right === 1) return '前進'
  if (command.left === -1 && command.right === -1) return '後退'
  if (command.left === 1 && command.right === -1) return '左旋回'
  if (command.left === -1 && command.right === 1) return '右旋回'
  return '方向調整'
}

function Room() {
  return (
    <>
      <RigidBody type="fixed" colliders="cuboid" restitution={0} friction={0.8}>
        <mesh position={[0, -0.12, 0]} receiveShadow>
          <boxGeometry args={[12, 0.24, 12]} />
          <meshStandardMaterial color="#111722" roughness={0.86} metalness={0.08} />
        </mesh>
      </RigidBody>
      <mesh position={[0, 2.7, -5.8]}>
        <boxGeometry args={[12, 5.4, 0.2]} />
        <meshStandardMaterial color="#0c121c" roughness={0.92} />
      </mesh>
      <mesh position={[-5.9, 2.7, 0]}>
        <boxGeometry args={[0.2, 5.4, 11.5]} />
        <meshStandardMaterial color="#0c121c" roughness={0.92} />
      </mesh>
      <mesh position={[5.9, 2.7, 0]}>
        <boxGeometry args={[0.2, 5.4, 11.5]} />
        <meshStandardMaterial color="#0c121c" roughness={0.92} />
      </mesh>
      <Text
        position={[0, 4.85, -5.66]}
        fontSize={0.28}
        color="#e3edf8"
        anchorX="center"
        anchorY="middle"
        material-toneMapped={false}
      >
        RC WORLD · LIVE MONITOR
      </Text>
      <Text
        position={[0, 4.48, -5.66]}
        fontSize={0.095}
        color="#7392ae"
        anchorX="center"
        anchorY="middle"
        material-toneMapped={false}
      >
        VDO.NINJA WEBRTC INPUT
      </Text>
    </>
  )
}

function Lighting() {
  return (
    <>
      <ambientLight intensity={0.72} color="#bdcce3" />
      <directionalLight position={[-4, 7, 5]} intensity={1.25} color="#dbeaff" castShadow />
      <pointLight position={[-3.8, 3.2, -4.5]} intensity={16} distance={8} color="#1386c1" />
      <pointLight position={[3.8, 3.1, -4.5]} intensity={13} distance={8} color="#8248bf" />
    </>
  )
}

function VdoNinjaReceiver() {
  const [url, setUrl] = useState(() => new URLSearchParams(window.location.search).get('rcView') ?? '')
  const [status, setStatus] = useState<ReceiverStatus>('idle')
  const [error, setError] = useState('')
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const sdkRef = useRef<VDONinjaSDK | null>(null)
  const streamIdRef = useRef<string | null>(null)
  const sessionRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const videoElementRef = useRef<HTMLVideoElement | null>(null)
  const activeTextureRef = useRef<VideoTexture | null>(null)
  const monitorMaterialRef = useRef<MeshBasicMaterial | null>(null)

  const videoTexture = useMemo(() => {
    if (!videoElement) return null
    const texture = new VideoTexture(videoElement)
    texture.colorSpace = SRGBColorSpace
    return texture
  }, [videoElement])

  useEffect(() => {
    const material = monitorMaterialRef.current
    if (!material) return
    material.map = videoTexture
    material.color.set(videoTexture ? '#ffffff' : '#080d14')
    material.needsUpdate = true
  }, [videoTexture])

  useEffect(() => {
    activeTextureRef.current = videoTexture
    return () => {
      activeTextureRef.current = null
      if (videoTexture) {
        queueMicrotask(() => {
          if (activeTextureRef.current !== videoTexture) videoTexture.dispose()
        })
      }
    }
  }, [videoTexture])

  const stop = useCallback(() => {
    sessionRef.current += 1
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = null

    const sdk = sdkRef.current
    const streamId = streamIdRef.current
    sdkRef.current = null
    streamIdRef.current = null
    if (sdk) {
      if (streamId) sdk.stopViewing(streamId)
      void sdk.disconnect()
    }

    if (videoElementRef.current) {
      videoElementRef.current.pause()
      videoElementRef.current.srcObject = null
      videoElementRef.current.remove()
    }
    videoElementRef.current = null
    setVideoElement(null)
    setStatus('idle')
    setError('')
  }, [])

  const connect = useCallback(async () => {
    let config: VdoViewerConfig
    try {
      config = parseViewerUrl(url)
    } catch (caught) {
      setStatus('error')
      setError(caught instanceof Error ? caught.message : 'URLを確認してください')
      return
    }

    const session = sessionRef.current + 1
    sessionRef.current = session
    setStatus('connecting')
    setError('')

    const sdk = new VDONinjaSDK({
      salt: 'vdo.ninja',
      host: config.signalingHost,
      room: config.room,
      password: config.password,
      connectionTimeout: 20000,
      autoRecover: true,
      autoRelay: true,
    })
    sdkRef.current = sdk
    streamIdRef.current = config.streamId

    const fail = (message: string) => {
      if (sessionRef.current !== session) return
      sessionRef.current += 1
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = null
      if (sdkRef.current === sdk) {
        sdkRef.current = null
        streamIdRef.current = null
        sdk.stopViewing(config.streamId)
        void sdk.disconnect()
      }
      if (videoElementRef.current) {
        videoElementRef.current.pause()
        videoElementRef.current.srcObject = null
        videoElementRef.current.remove()
      }
      videoElementRef.current = null
      setVideoElement(null)
      setStatus('error')
      setError(message)
    }

    sdk.addEventListener('track', (event) => {
      if (sessionRef.current !== session) return
      const detail = (event as CustomEvent<{ track: MediaStreamTrack; streams?: MediaStream[] }>).detail
      if (detail.track.kind !== 'video') return
      detail.track.addEventListener('ended', () => fail('映像配信が終了しました'), { once: true })

      const stream = detail.streams?.[0] ?? new MediaStream([detail.track])
      let video = videoElementRef.current
      if (!video) {
        const element = document.createElement('video')
        element.autoplay = true
        element.muted = true
        element.playsInline = true
        Object.assign(element.style, {
          position: 'fixed',
          width: '1px',
          height: '1px',
          left: '-2px',
          top: '-2px',
          opacity: '0',
          pointerEvents: 'none',
        })
        document.body.appendChild(element)
        element.addEventListener('loadeddata', () => {
          if (sessionRef.current !== session) return
          if (element.videoWidth === 0 || element.videoHeight === 0) return
          if (timeoutRef.current) clearTimeout(timeoutRef.current)
          timeoutRef.current = null
          setVideoElement(element)
          setStatus('receiving')
        }, { once: true })
        element.addEventListener('error', () => fail('映像を再生できませんでした'))
        videoElementRef.current = element
        video = element
      }
      video.srcObject = stream
      void video.play().catch(() => fail('映像の再生を開始できませんでした'))
    })

    sdk.addEventListener('connectionFailed', () => fail('VDO.Ninjaへの接続に失敗しました'))
    sdk.addEventListener('disconnected', (event) => {
      const detail = (event as CustomEvent<{ intentional: boolean; willReconnect: boolean }>).detail
      if (!detail.intentional && !detail.willReconnect) fail('VDO.Ninjaとの接続が切れました')
    })
    sdk.addEventListener('reconnectFailed', () => fail('VDO.Ninjaとの接続を復旧できませんでした'))

    timeoutRef.current = setTimeout(() => {
      fail('映像を受信できません。配信状態とURLを確認してください')
    }, 25000)

    try {
      await sdk.connect()
      if (sessionRef.current !== session) return
      if (config.room) await sdk.joinRoom({ room: config.room, password: config.password })
      if (sessionRef.current !== session) return
      await sdk.view(config.streamId, { audio: false, video: true })
    } catch (caught) {
      fail(caught instanceof Error ? caught.message : '接続できませんでした')
    }
  }, [url])

  const autoConnectRef = useRef(false)
  useEffect(() => {
    if (url && !autoConnectRef.current) {
      autoConnectRef.current = true
      void connect()
    }
  }, [connect, url])

  useEffect(() => () => {
    sessionRef.current += 1
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    const sdk = sdkRef.current
    const streamId = streamIdRef.current
    if (sdk) {
      if (streamId) sdk.stopViewing(streamId)
      void sdk.disconnect()
    }
    if (videoElementRef.current) {
      videoElementRef.current.pause()
      videoElementRef.current.srcObject = null
      videoElementRef.current.remove()
    }
  }, [])

  const isConnected = status === 'connecting' || status === 'receiving'
  const statusLabel = {
    idle: 'URLを設定して接続してください',
    connecting: 'VDO.Ninjaに接続中…',
    receiving: '映像を受信中',
    error: error || '接続を確認してください',
  }[status]

  return (
    <>
      <group position={[0, 2.65, -5.42]}>
        <mesh position={[0, 0, -0.1]} castShadow>
          <boxGeometry args={[5.2, 3.05, 0.2]} />
          <meshStandardMaterial color="#101722" metalness={0.25} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0, 0.012]}>
          <planeGeometry args={[4.9, 2.75]} />
          <meshBasicMaterial
            ref={monitorMaterialRef}
            toneMapped={false}
          />
        </mesh>
        {!videoTexture && (
          <Text
            position={[0, 0, 0.03]}
            fontSize={0.18}
            color="#7e91a5"
            anchorX="center"
            anchorY="middle"
            material-toneMapped={false}
          >
            VDO.NINJA VIDEO
          </Text>
        )}
      </group>

      <group position={[-3.35, 1.2, -1.8]}>
        <mesh position={[0, 0, -0.08]} castShadow>
          <boxGeometry args={[4.8, 1.05, 0.16]} />
          <meshStandardMaterial color="#151e2a" metalness={0.18} roughness={0.55} />
        </mesh>
        <Text
          position={[-2.12, 0.26, 0.02]}
          fontSize={0.115}
          color="#dce7f1"
          anchorX="left"
          anchorY="middle"
          material-toneMapped={false}
        >
          VDO.Ninja 視聴URL
        </Text>
        <TextInput
          id="rc-world-vdo-view-url"
          placeholder="https://vdo.ninja/?view=..."
          maxLength={2048}
          value={url}
          onSubmit={(value) => setUrl(value.trim())}
          interactionText="視聴URLを入力"
        >
          <group position={[0, -0.12, 0.025]}>
            <mesh>
              <boxGeometry args={[4.25, 0.34, 0.045]} />
              <meshStandardMaterial color="#0a111b" metalness={0.08} roughness={0.58} />
            </mesh>
            <Text
              position={[-2.02, 0, 0.03]}
              fontSize={0.088}
              color={url ? '#b8d5eb' : '#74879b'}
              anchorX="left"
              anchorY="middle"
              maxWidth={3.95}
              material-toneMapped={false}
            >
              {url || 'クリックしてURLを設定'}
            </Text>
          </group>
        </TextInput>
        <Interactable
          id="rc-world-vdo-connect"
          type="button"
          enabled={isConnected || Boolean(url.trim())}
          interactionText={isConnected ? 'VDO.Ninjaを切断' : 'VDO.Ninjaに接続'}
          onInteract={() => isConnected ? stop() : void connect()}
        >
          <group position={[0, -0.46, 0.025]}>
            <mesh>
              <boxGeometry args={[2.15, 0.34, 0.065]} />
              <meshStandardMaterial
                color={isConnected ? '#713e46' : url.trim() ? '#15546a' : '#242b34'}
                metalness={0.2}
                roughness={0.42}
              />
            </mesh>
            <Text
              position={[0, 0, 0.04]}
              fontSize={0.105}
              color={url.trim() || isConnected ? '#e6f1f8' : '#697584'}
              anchorX="center"
              anchorY="middle"
              material-toneMapped={false}
            >
              {isConnected ? '切断' : '接続'}
            </Text>
          </group>
        </Interactable>
      </group>

      <Text
        position={[0, 0.36, -2.25]}
        fontSize={0.1}
        color={status === 'receiving' ? '#7ee0aa' : status === 'error' ? '#ff8f88' : '#aab9c8'}
        anchorX="center"
        anchorY="middle"
        textAlign="center"
        maxWidth={4.8}
        material-toneMapped={false}
      >
        {statusLabel}
      </Text>
    </>
  )
}

function parseViewerUrl(input: string): VdoViewerConfig {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('VDO.Ninjaの視聴URLを入力してください')
  }

  const hostname = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || !(hostname === 'vdo.ninja' || hostname.endsWith('.vdo.ninja'))) {
    throw new Error('https://vdo.ninja の視聴URLを入力してください')
  }

  const params = new URLSearchParams(url.search)
  const fragment = url.hash.replace(/^#\??/, '')
  if (fragment.includes('=')) {
    new URLSearchParams(fragment).forEach((value, key) => params.set(key, value))
  }

  const view = params.get('view')?.trim()
  if (!view) throw new Error('URLに view= の指定がありません')
  if (view.includes(',')) throw new Error('初回は1つの映像を指定した視聴URLを使ってください')

  const room = params.get('room')?.trim() || undefined
  const encodedPassword = params.get('password')
  let password: string | false | undefined
  if (encodedPassword === 'false') {
    password = false
  } else if (encodedPassword) {
    password = new URLSearchParams([['value', encodedPassword]]).get('value') ?? encodedPassword
  }

  const customSignaling = params.get('wss2')?.trim()
  const signalingHost = customSignaling
    ? customSignaling.startsWith('wss://') ? customSignaling : `wss://${customSignaling}`
    : 'wss://wss.vdo.ninja'
  let signalingUrl: URL
  try {
    signalingUrl = new URL(signalingHost)
  } catch {
    throw new Error('視聴URLのシグナリング先が不正です')
  }
  const allowedSignalingHosts = ['wss.vdo.ninja', 'apibackup.vdo.ninja']
  if (signalingUrl.protocol !== 'wss:' || !allowedSignalingHosts.includes(signalingUrl.hostname)) {
    throw new Error('VDO.Ninjaのシグナリング先を指定してください')
  }

  return { streamId: view, room, password, signalingHost: signalingUrl.href }
}
