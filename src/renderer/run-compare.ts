import { compareRunData } from '../shared/experiments/compare'

export const runCompare = (input: any) => {
  if (typeof Worker === 'undefined') return Promise.resolve(compareRunData(input))
  return new Promise<any>((resolve, reject) => {
    const worker = new Worker(new URL('./compare.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => { resolve(event.data); worker.terminate() }
    worker.onerror = (event) => { reject(new Error(event.message || 'Compare Worker failed.')); worker.terminate() }
    worker.postMessage(input)
  })
}
