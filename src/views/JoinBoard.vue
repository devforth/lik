<template>
  <div class="fixed inset-0 z-50 overflow-hidden bg-black text-white">
    <div v-if="!manualMode" class="absolute inset-0 flex items-center justify-center">
      <div class="relative w-[86vmin] h-[86vmin] max-w-[92vw] max-h-[92vw] rounded-lg overflow-hidden ring-2 ring-white/70">
        <video
          ref="videoRef"
          autoplay
          playsinline
          muted
          class="absolute inset-0 w-full h-full object-cover bg-black"
        />
        <!-- square overlay -->
        <div class="absolute inset-0 pointer-events-none">
          <div class="absolute inset-0 border-2 border-white/70 rounded-lg mix-blend-screen" />
        </div>
      </div>
    </div>

    <!-- Top bar -->
  <div class="absolute top-4 left-0 right-0 p-6 safe-top bg-gradient-to-b from-black/60 to-transparent">
      <div class="flex items-center gap-2">
        <button class="flex items-center gap-2 text-white/90" @click="goBack">
          <ArrowLeft class="w-5 h-5" />
          <span class="text-sm">Back</span>
        </button>
      </div>
      <div class="mt-1 text-xs text-white/70" v-if="statusText">{{ statusText }}</div>
    </div>

    <!-- Bottom controls -->
  <div class="absolute bottom-4 left-0 right-0 p-4 pb-12 safe-bottom space-y-3 bg-gradient-to-t from-black/70 via-black/30 to-transparent">
      <div class="flex items-center gap-2">
        <Input
          v-if="manualMode"
          v-model="manualCode"
          placeholder="Enter share code like lik::xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx::<secret>"
          class="flex-1 bg-white/10 text-white placeholder:text-white/60 border-white/30"
        />
        <Button v-if="manualMode" @click="submitManual">Join</Button>
      </div>

      <div class="flex items-center justify-center gap-3">
        <Button variant="outline" class="bg-white/10 text-white border-white/30" @click="toggleManual">
          {{ manualMode ? 'Hide manual' : 'Enter manually' }}
        </Button>
        <Button v-if="!manualMode" variant="outline" class="bg-white/10 text-white border-white/30" @click="restartScan" :disabled="isStarting">
          Restart scan
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'vue-sonner'
import { useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import { useScoreboardsStore } from '@/stores/scoreboards'

const router = useRouter()
const scoreboards = useScoreboardsStore()
const videoRef = ref<HTMLVideoElement | null>(null)
const streamRef = ref<MediaStream | null>(null)
const detecting = ref(false)
const isStarting = ref(false)
const statusText = ref('')
const manualMode = ref(false)
const manualCode = ref('')

function goBack() {
  router.back()
}

function toggleManual() {
  const next = !manualMode.value
  manualMode.value = next
  if (next) {
    // entering manual mode: stop camera and hide preview
    stopCamera()
    statusText.value = 'Manual entry'
  } else {
    // leaving manual mode: resume camera and scanning
    statusText.value = ''
    startCamera()
  }
}

function isLikCode(s: string) {
  return /^lik::[0-9a-fA-F-]{8,}::[0-9a-fA-F]{64,}$/.test(s)
}

function handleCode(code: string) {
  if (!isLikCode(code)) {
    toast.error('Invalid code', { description: 'Code must be lik::id::secret' })
    return
  }
  // call join action
  void (async () => {
    const res = await scoreboards.join(code)
    if (res.ok) {
      // Navigate directly to the joined board
      const id = res.boardId;
      if (id) {
        setTimeout(() => router.push({ name: 'scoreboard', params: { id } }), 200)
      }
    }
    // errors are already toasted in the store
  })()
}

function submitManual() {
  const code = manualCode.value.trim()
  if (!code) return
  handleCode(code)
}

async function startCamera() {
  if (isStarting.value) return
  isStarting.value = true
  statusText.value = 'Requesting camera permission…'
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    streamRef.value = stream
    if (videoRef.value) {
      videoRef.value.srcObject = stream
      await videoRef.value.play().catch(() => {})
    }
    statusText.value = 'Starting scanner…'
    startDetectLoop()
  } catch (e: any) {
    console.error(e)
    toast.error('Camera access denied', { description: 'Please grant permission and try again.' })
    statusText.value = 'Camera permission denied'
  } finally {
    isStarting.value = false
  }
}

let rafId = 0
let detector: any = null

async function ensureBarcodeDetector() {
  // Try native BarcodeDetector. If absent, skip detection.
  const w = window as any
  if (w.BarcodeDetector) {
    const formats = ['qr_code']
    detector = new w.BarcodeDetector({ formats })
    return true
  }
  statusText.value = 'QR detection not supported in this environment'
  return false
}

async function startDetectLoop() {
  if (detecting.value) return
  detecting.value = true
  const ok = await ensureBarcodeDetector()
  if (!ok) return

  const detect = async () => {
    try {
      const video = videoRef.value
      if (!video) return
      if (video.readyState >= 2) {
        const codes = await detector.detect(video)
        if (codes && codes.length) {
          const raw = (codes[0].rawValue ?? '').toString()
          if (raw) {
            detecting.value = false
            handleCode(raw)
            return
          }
        }
      }
    } catch (e) {
      // swallow transient
    }
    if (detecting.value) rafId = requestAnimationFrame(detect)
  }
  rafId = requestAnimationFrame(detect)
}

function stopCamera() {
  detecting.value = false
  if (rafId) cancelAnimationFrame(rafId)
  const s = streamRef.value
  if (s) {
    for (const t of s.getTracks()) t.stop()
    streamRef.value = null
  }
}

function restartScan() {
  stopCamera()
  startCamera()
}

onMounted(() => {
  if (!manualMode.value) startCamera()
})

onBeforeUnmount(() => {
  stopCamera()
})
</script>

<style scoped>
/***** ensure safe area *****/
.safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
.safe-top { padding-top: env(safe-area-inset-top); }
</style>
