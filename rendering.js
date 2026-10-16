import * as THREE from './vendor/three.module.js';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { ShaderPass } from './vendor/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';
import { FXAAShader } from './vendor/addons/shaders/FXAAShader.js';

/** Local Three.js render pipeline: linear HDR, bloom, film grade, ACES, FXAA. */
export function createRenderPipeline(renderer, scene, camera) {
  renderer.info.autoReset = false;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .16, .45, 1.05);
  composer.addPass(bloom);
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, night: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform sampler2D tDiffuse;uniform float night;varying vec2 vUv;
      void main(){
        vec3 c=texture2D(tDiffuse,vUv).rgb;
        vec3 warm=vec3(1.025,1.008,.975), cool=vec3(.97,1.015,1.04);
        c*=mix(warm,cool,night);
        float vignette=1.-smoothstep(.15,.85,distance(vUv,vec2(.5)));
        c*=mix(.91,1.,vignette);
        gl_FragColor=vec4(c,1.);
      }`
  });
  composer.addPass(grade); composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa);
  let detailed = true;
  const environments = [];
  function environment(night) {
    const index = night ? 1 : 0;
    scene.environmentIntensity = night ? .45 : .7;
    if (environments[index]) { scene.environment = environments[index].texture; return; }
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d'), sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, night ? '#17364d' : '#a9c4cf'); sky.addColorStop(.49, night ? '#415369' : '#f0dbb6');
    sky.addColorStop(.52, night ? '#233847' : '#b3a48b'); sky.addColorStop(1, night ? '#141d24' : '#6f6b5b');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 1024, 512);
    if (!night) { const glow = ctx.createRadialGradient(175, 210, 4, 175, 210, 90); glow.addColorStop(0, '#fff9dd'); glow.addColorStop(.15, '#ffe5ba'); glow.addColorStop(1, '#f0dbb600'); ctx.fillStyle = glow; ctx.fillRect(0, 0, 1024, 512); }
    const texture = new THREE.CanvasTexture(canvas); texture.mapping = THREE.EquirectangularReflectionMapping; texture.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer); environments[index] = pmrem.fromEquirectangular(texture); pmrem.dispose(); texture.dispose();
    scene.environment = environments[index].texture;
  }
  function resize(w, h) {
    const ratio = renderer.getPixelRatio(); composer.setPixelRatio(ratio); composer.setSize(w, h);
    fxaa.material.uniforms.resolution.value.set(1 / (w * ratio), 1 / (h * ratio));
  }
  resize(innerWidth, innerHeight); environment(false);
  return {
    render(dt) { renderer.info.reset(); detailed ? composer.render(dt) : renderer.render(scene, camera); },
    resize,
    setQuality(value) { detailed = value !== 'low'; bloom.enabled = detailed; resize(innerWidth, innerHeight); },
    setNight(value) { grade.uniforms.night.value = value ? 1 : 0; bloom.strength = value ? .25 : .16; environment(value); },
    dispose() { composer.dispose(); environments.forEach(e => e?.dispose()); }
  };
}
