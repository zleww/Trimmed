import { useEffect, useRef } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Timer,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Points,
  ACESFilmicToneMapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  WebGLRenderer,
  type Material,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

/*
  The hero's 3D piece: a barber pole made entirely in code (no model file).
  - inner tube: a shader paints the spiral stripes and slides them, the classic "endless climb"
  - glass sleeve: only its edges glow (fresnel), so it reads as glass without costly refraction
  - brass caps: real metal, lit by a generated studio room (RoomEnvironment)
  - two gold orbit rings and rising dust, like the gold ring in the reference

  The parent passes `motion`, a plain object it updates from scroll (0..1).
  Mutating an object instead of passing props means React never re-renders 60 times a second.
*/

export type PoleMotion = { scroll: number }

const AMBER = '#d6a54e'
const BONE = '#ece5d6'
const INK = '#1c1930'

const stripeVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 world = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-world.xyz);
    gl_Position = projectionMatrix * world;
  }
`

const stripeFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uAmber;
  uniform vec3 uBone;
  uniform vec3 uInk;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // diagonal bands: around the tube (uv.x) plus up the tube (uv.y), sliding with time
    float s = fract(vUv.x * 3.0 + vUv.y * 2.4 - uTime * 0.18);
    float edge = 0.012;
    float amber = smoothstep(0.0, edge, s) - smoothstep(0.36 - edge, 0.36, s);
    float ink = smoothstep(0.5, 0.5 + edge, s) - smoothstep(0.86 - edge, 0.86, s);
    vec3 col = uBone;
    col = mix(col, uAmber, amber);
    col = mix(col, uInk, ink);

    // soft studio light: a key from the upper left, plus a bright vertical sheen
    float key = max(dot(vNormal, normalize(vec3(-0.5, 0.4, 1.0))), 0.0);
    float sheen = pow(max(dot(vNormal, normalize(vec3(0.35, 0.0, 1.0))), 0.0), 28.0);
    col *= 0.38 + 0.75 * key;
    col += sheen * 0.35;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const glassFragment = /* glsl */ `
  uniform vec3 uTint;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - abs(dot(vNormal, vView)), 2.6);
    // two thin highlights running down the glass
    float streak = smoothstep(0.02, 0.0, abs(vUv.x - 0.06)) * 0.5 + smoothstep(0.012, 0.0, abs(vUv.x - 0.1)) * 0.3;
    float alpha = clamp(rim * 0.75 + streak * 0.6, 0.0, 1.0);
    gl_FragColor = vec4(uTint * (0.6 + rim), alpha);
    #include <colorspace_fragment>
  }
`

const dustVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute float aSpeed;
  attribute float aSize;
  varying float vFade;
  void main() {
    vec3 p = position;
    // rise forever: wrap around a 5-unit tall column
    p.y = mod(p.y + uTime * aSpeed + 2.5, 5.0) - 2.5;
    p.x += sin(uTime * 0.3 + position.y * 2.0) * 0.06;
    vFade = smoothstep(2.5, 1.6, abs(p.y));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * uPixelRatio * (6.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`

const dustFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vFade * 0.75;
    gl_FragColor = vec4(uColor, a);
  }
`

type Props = {
  motion: PoleMotion
  /** called once if WebGL can't start, so the hero can show its still version */
  onFail?: () => void
  className?: string
}

export default function BarberPoleScene({ motion, onFail, className = '' }: Props) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      onFail?.()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.domElement.setAttribute('aria-hidden', 'true')
    renderer.domElement.style.display = 'block'
    el.appendChild(renderer.domElement)

    const scene = new Scene()
    const pmrem = new PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    const envTexture = pmrem.fromScene(room, 0.04).texture
    scene.environment = envTexture

    const camera = new PerspectiveCamera(32, 1, 0.1, 50)
    camera.position.set(0, 0, 8.2)

    const warm = new DirectionalLight(new Color(AMBER), 2.2)
    warm.position.set(3, 2, 2)
    scene.add(warm)

    // everything that moves together with the pointer
    const rig = new Group()
    scene.add(rig)
    const pole = new Group()
    rig.add(pole)

    const geometries: BufferGeometry[] = []
    const materials: Material[] = []
    const track = <G extends BufferGeometry, M extends Material>(g: G, m: M) => {
      geometries.push(g)
      materials.push(m)
      return new Mesh(g, m)
    }

    // inner striped tube
    const stripeMat = new ShaderMaterial({
      vertexShader: stripeVertex,
      fragmentShader: stripeFragment,
      uniforms: {
        uTime: { value: 0 },
        uAmber: { value: new Color(AMBER) },
        uBone: { value: new Color(BONE) },
        uInk: { value: new Color(INK) },
      },
    })
    pole.add(track(new CylinderGeometry(0.34, 0.34, 2.7, 96, 1, true), stripeMat))

    // glass sleeve
    const glassMat = new ShaderMaterial({
      vertexShader: stripeVertex,
      fragmentShader: glassFragment,
      uniforms: { uTint: { value: new Color(BONE) } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    })
    pole.add(track(new CylinderGeometry(0.42, 0.42, 2.72, 96, 1, true), glassMat))

    // brass: a short drum, a dome and a small ball, top and bottom
    const brass = new MeshStandardMaterial({ color: new Color('#c9963f'), metalness: 1, roughness: 0.26 })
    materials.push(brass)
    const drumGeo = new CylinderGeometry(0.5, 0.5, 0.2, 96)
    const lipGeo = new TorusGeometry(0.5, 0.03, 16, 96)
    const domeGeo = new SphereGeometry(0.5, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2)
    const ballGeo = new SphereGeometry(0.13, 32, 16)
    geometries.push(drumGeo, lipGeo, domeGeo, ballGeo)
    for (const side of [1, -1]) {
      const cap = new Group()
      const drum = new Mesh(drumGeo, brass)
      const lip = new Mesh(lipGeo, brass)
      lip.rotation.x = Math.PI / 2
      lip.position.y = -0.1
      const dome = new Mesh(domeGeo, brass)
      dome.scale.y = 0.55
      dome.position.y = 0.1
      const ball = new Mesh(ballGeo, brass)
      ball.position.y = 0.48
      cap.add(drum, lip, dome, ball)
      cap.position.y = side * 1.46
      if (side === -1) cap.rotation.x = Math.PI
      pole.add(cap)
    }

    // gold orbit rings
    const ringMat = new MeshStandardMaterial({ color: new Color(AMBER), metalness: 1, roughness: 0.35, emissive: new Color('#3a2a0c') })
    materials.push(ringMat)
    const ringA = new Mesh(new TorusGeometry(1.7, 0.012, 12, 220), ringMat)
    const ringB = new Mesh(new TorusGeometry(2.05, 0.006, 12, 220), ringMat)
    geometries.push(ringA.geometry, ringB.geometry)
    ringA.rotation.set(1.28, 0, 0.32)
    ringB.rotation.set(1.42, 0, -0.5)
    rig.add(ringA, ringB)

    // rising gold dust (moved on the GPU, no per-frame JavaScript work)
    const count = window.innerWidth < 640 ? 160 : 320
    const positions = new Float32Array(count * 3)
    const speeds = new Float32Array(count)
    const sizes = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const r = 0.7 + Math.random() * 1.9
      const a = Math.random() * Math.PI * 2
      positions[i * 3] = Math.cos(a) * r
      positions[i * 3 + 1] = Math.random() * 5 - 2.5
      positions[i * 3 + 2] = Math.sin(a) * r
      speeds[i] = 0.05 + Math.random() * 0.18
      sizes[i] = 2 + Math.random() * 5
    }
    const dustGeo = new BufferGeometry()
    dustGeo.setAttribute('position', new BufferAttribute(positions, 3))
    dustGeo.setAttribute('aSpeed', new BufferAttribute(speeds, 1))
    dustGeo.setAttribute('aSize', new BufferAttribute(sizes, 1))
    const dustMat = new ShaderMaterial({
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() }, uColor: { value: new Color(AMBER) } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    geometries.push(dustGeo)
    materials.push(dustMat)
    rig.add(new Points(dustGeo, dustMat))

    // fit the canvas to its box
    const resize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      camera.aspect = w / h
      // keep the whole pole in view on tall, narrow boxes
      camera.position.z = w / h < 0.8 ? 9.6 : 8.2
      camera.updateProjectionMatrix()
    }
    resize()
    const sizeWatch = new ResizeObserver(resize)
    sizeWatch.observe(el)

    // pointer: the rig leans toward it, eased so it never snaps
    const pointer = { x: 0, y: 0 }
    const onPointer = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1
    }
    if (!reduce) window.addEventListener('pointermove', onPointer, { passive: true })

    const timer = new Timer()
    let elapsed = 0
    const render = () => {
      timer.update()
      const dt = Math.min(timer.getDelta(), 0.05)
      elapsed += dt
      const s = motion.scroll
      stripeMat.uniforms.uTime!.value = elapsed
      dustMat.uniforms.uTime!.value = elapsed
      pole.rotation.y = elapsed * 0.25 + s * Math.PI * 1.2
      pole.rotation.z = 0.12
      ringA.rotation.z = 0.32 + elapsed * 0.12
      ringB.rotation.z = -0.5 - elapsed * 0.07
      rig.rotation.x += (pointer.y * 0.18 + s * 0.35 - rig.rotation.x) * 0.06
      rig.rotation.y += (pointer.x * 0.35 - rig.rotation.y) * 0.06
      rig.position.y = s * 0.6
      renderer.render(scene, camera)
    }

    // only draw while on screen and the tab is open
    let onScreen = true
    const sync = () => renderer.setAnimationLoop(onScreen && !document.hidden && !reduce ? render : null)
    const seen = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true
      sync()
    })
    seen.observe(el)
    document.addEventListener('visibilitychange', sync)
    if (reduce) {
      // one still frame, posed nicely
      elapsed = 1.6
      render()
    } else {
      sync()
    }

    return () => {
      renderer.setAnimationLoop(null)
      seen.disconnect()
      sizeWatch.disconnect()
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('pointermove', onPointer)
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      envTexture.dispose()
      room.dispose()
      pmrem.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [motion, onFail])

  return <div ref={host} className={className} />
}
