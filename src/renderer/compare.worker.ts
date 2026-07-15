import { compareRunData } from '../shared/experiments/compare'
self.onmessage = (event: MessageEvent) => postMessage(compareRunData(event.data))
