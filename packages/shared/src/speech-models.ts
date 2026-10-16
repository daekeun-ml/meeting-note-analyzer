import { z } from "zod";

export const STT_MODELS = [
  { id: "qwen3-asr", label: "Qwen3-ASR-1.7B-hf", repository: "Qwen/Qwen3-ASR-1.7B-hf", description: "한국어를 지원하는 기본 모델입니다. 단어별 시간 정렬을 함께 수행합니다." },
  { id: "crisperwhisper", label: "CrisperWhisper 2.0 large", repository: "nyralabs/CrisperWhisper2.0_large", description: "기존 전사 모델입니다. 단어별 시간 정보와 발화 그대로 전사를 지원합니다." },
  { id: "ark-asr", label: "ARK-ASR-0.6B (영어)", repository: "Edge0/ARK-ASR-0.6B", description: "영어 녹음용 비교 모델입니다. 한국어 검증에서 다른 언어로 출력하는 문제가 있어 영어로 제한합니다." },
] as const;
export const DIARIZATION_MODELS = [
  { id: "nemotron3", label: "NVIDIA Nemotron 3 Diarization", repository: "nvidia/Nemotron-3-Diarization", description: "기본 모델입니다. 최대 8명의 화자를 구분합니다." },
  { id: "community1", label: "pyannote Community-1", repository: "pyannote/speaker-diarization-community-1", description: "기존 화자 분리 모델입니다. 녹음 전체의 목소리를 비교해 화자를 구분합니다." },
  { id: "none", label: "화자 분리 사용 안 함", repository: null, description: "한 명만 말하는 녹음에 사용합니다. 전체를 S1으로 표시합니다." },
] as const;
export const speechModelsSchema = z.object({
  stt: z.enum(["qwen3-asr", "crisperwhisper", "ark-asr"]),
  diarization: z.enum(["nemotron3", "community1", "none"]),
}).strict();
export type SpeechModels = z.infer<typeof speechModelsSchema>;
export const DEFAULT_SPEECH_MODELS: SpeechModels = { stt: "qwen3-asr", diarization: "nemotron3" };
export const LEGACY_SPEECH_MODELS: SpeechModels = { stt: "crisperwhisper", diarization: "community1" };
export function sameSpeechModels(left: SpeechModels, right: SpeechModels) {
  return left.stt === right.stt && left.diarization === right.diarization;
}
export function speechLanguageError(models: SpeechModels, language?: string) {
  return models.stt === "ark-asr" && language !== "en" ? "ARK는 현재 영어 녹음용입니다. 녹음 언어를 영어로 지정하거나 Qwen 또는 CrisperWhisper를 선택하세요." : null;
}
