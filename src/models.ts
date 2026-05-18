/**
 * Model Definitions v19.0
 * Comprehensive model catalog with multi-provider support
 * Categories: OpenCode Free, GLM Language, GLM Vision, GLM Specialized
 */

// ─── Provider Types ───────────────────────────────────────

export type Provider = 'opencode' | 'zhipuai' | 'zhipuai-coding';

export interface ModelDefinition {
  id: string;
  name: string;
  provider: Provider;
  category: 'free' | 'language' | 'vision' | 'reasoning' | 'specialized';
  description: string;
  emoji: string;
  contextLimit?: number;
  maxOutput?: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsThinking: boolean;
  free: boolean;
}

// ─── All Models ───────────────────────────────────────────

export const MODELS: ModelDefinition[] = [
  // ─── OpenCode Free Models ─────────────────────────────
  {
    id: 'big-pickle',
    name: 'Big Pickle',
    provider: 'opencode',
    category: 'free',
    description: 'نموذج مجاني قوي متعدد الأغراض',
    emoji: '🆓',
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    free: true,
  },
  {
    id: 'deepseek-v4-flash-free',
    name: 'DeepSeek V4 Flash',
    provider: 'opencode',
    category: 'free',
    description: 'سريع وفعال — مجاني',
    emoji: '🆓',
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    free: true,
  },
  {
    id: 'minimax-m2.5-free',
    name: 'MiniMax M2.5',
    provider: 'opencode',
    category: 'free',
    description: 'متجدد ومتوازن — مجاني',
    emoji: '🆓',
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    free: true,
  },
  {
    id: 'nemotron-3-super-free',
    name: 'Nemotron 3 Super',
    provider: 'opencode',
    category: 'free',
    description: 'من NVIDIA — مجاني',
    emoji: '🆓',
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    free: true,
  },

  // ─── GLM-5 Series (Latest Flagship) ────────────────────
  {
    id: 'glm-5.1',
    name: 'GLM-5.1',
    provider: 'zhipuai',
    category: 'language',
    description: 'الأحدث — منافس Claude Opus 4.6 — عمل ذاتي 8 ساعات',
    emoji: '👑',
    contextLimit: 200000,
    maxOutput: 128000,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: true,
    free: false,
  },
  {
    id: 'glm-5',
    name: 'GLM-5',
    provider: 'zhipuai',
    category: 'language',
    description: 'جيل جديد للهندسة الذاتية — منافس Claude Opus 4.5',
    emoji: '🏆',
    contextLimit: 200000,
    maxOutput: 128000,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: true,
    free: false,
  },
  {
    id: 'glm-5-turbo',
    name: 'GLM-5 Turbo',
    provider: 'zhipuai',
    category: 'language',
    description: 'محسّن لـ OpenClaw — أدوات + تعليمات متقدمة',
    emoji: '⚡',
    contextLimit: 200000,
    maxOutput: 128000,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: true,
    free: false,
  },

  // ─── GLM-4.7 Series ────────────────────────────────────
  {
    id: 'glm-4.7',
    name: 'GLM-4.7',
    provider: 'zhipuai',
    category: 'language',
    description: 'برمجة + استدلال متعدد الخطوات',
    emoji: '💎',
    contextLimit: 200000,
    maxOutput: 128000,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: true,
    free: false,
  },
  {
    id: 'glm-4.7-flashx',
    name: 'GLM-4.7 FlashX',
    provider: 'zhipuai',
    category: 'language',
    description: 'سريع وخفيف من GLM-4.7',
    emoji: '⚡',
    contextLimit: 200000,
    maxOutput: 128000,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    free: false,
  },
  {
    id: 'glm-4.7-flash',
    name: 'GLM-4.7 Flash',
    provider: 'zhipuai',
    category: 'free',
    description: 'مجاني تماماً من GLM-4.7',
    emoji: '🆓',
    contextLimit: 200000,
    maxOutput: 128000,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    free: true,
  },

  // ─── GLM-4.6 Series ────────────────────────────────────
  {
    id: 'glm-4.6',
    name: 'GLM-4.6',
    provider: 'zhipuai',
    category: 'language',
    description: 'متوازن — منافس Claude Sonnet 4',
    emoji: '🌟',
    contextLimit: 200000,
    maxOutput: 128000,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: true,
    free: false,
  },

  // ─── GLM-4.5 Series ────────────────────────────────────
  {
    id: 'glm-4.5',
    name: 'GLM-4.5',
    provider: 'zhipuai',
    category: 'reasoning',
    description: 'أقوى استدلال — MoE 355B/32B',
    emoji: '🧠',
    contextLimit: 128000,
    maxOutput: 96000,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: true,
    free: false,
  },
  {
    id: 'glm-4.5-air',
    name: 'GLM-4.5 Air',
    provider: 'zhipuai',
    category: 'language',
    description: 'اقتصادي — MoE 106B/12B',
    emoji: '🌬️',
    contextLimit: 128000,
    maxOutput: 96000,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    free: false,
  },
  {
    id: 'glm-4.5-flash',
    name: 'GLM-4.5 Flash',
    provider: 'zhipuai',
    category: 'free',
    description: 'مجاني — برمجة واستدلال',
    emoji: '🆓',
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    free: true,
  },

  // ─── GLM-4 Legacy (still useful) ───────────────────────
  {
    id: 'glm-4-flash',
    name: 'GLM-4 Flash',
    provider: 'zhipuai',
    category: 'free',
    description: 'سريع ومجاني — للاستخدام العام',
    emoji: '🆓',
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    free: true,
  },
  {
    id: 'glm-4-plus',
    name: 'GLM-4 Plus',
    provider: 'zhipuai',
    category: 'language',
    description: 'متميز — للبرمجة المتقدمة',
    emoji: '💎',
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    free: false,
  },
  {
    id: 'glm-4-long',
    name: 'GLM-4 Long',
    provider: 'zhipuai',
    category: 'language',
    description: 'سياق طويل — للوثائق الكبيرة',
    emoji: '📚',
    contextLimit: 128000,
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    free: false,
  },
  {
    id: 'glm-4-air',
    name: 'GLM-4 Air',
    provider: 'zhipuai',
    category: 'language',
    description: 'متوازن واقتصادي',
    emoji: '🌬️',
    supportsTools: true,
    supportsVision: false,
    supportsThinking: false,
    free: false,
  },

  // ─── Vision Models ─────────────────────────────────────
  {
    id: 'glm-5v-turbo',
    name: 'GLM-5V Turbo',
    provider: 'zhipuai',
    category: 'vision',
    description: 'بصري سريع من سلسلة GLM-5',
    emoji: '🖼️',
    supportsTools: true,
    supportsVision: true,
    supportsThinking: false,
    free: false,
  },
  {
    id: 'glm-4.6v',
    name: 'GLM-4.6V',
    provider: 'zhipuai',
    category: 'vision',
    description: 'بصري متقدم — تحليل الصور',
    emoji: '🖼️',
    supportsTools: true,
    supportsVision: true,
    supportsThinking: false,
    free: false,
  },
  {
    id: 'glm-4v-flash',
    name: 'GLM-4V Flash',
    provider: 'zhipuai',
    category: 'vision',
    description: 'بصري سريع ومجاني',
    emoji: '🖼️',
    supportsTools: false,
    supportsVision: true,
    supportsThinking: false,
    free: true,
  },
  {
    id: 'glm-4v-plus',
    name: 'GLM-4V Plus',
    provider: 'zhipuai',
    category: 'vision',
    description: 'بصري متميز',
    emoji: '🖼️',
    supportsTools: false,
    supportsVision: true,
    supportsThinking: false,
    free: false,
  },

  // ─── Reasoning Models ──────────────────────────────────
  {
    id: 'glm-z1-air',
    name: 'GLM-Z1 Air',
    provider: 'zhipuai',
    category: 'reasoning',
    description: 'تفكير عميق متوازن',
    emoji: '🧠',
    supportsTools: true,
    supportsVision: false,
    supportsThinking: true,
    free: false,
  },
  {
    id: 'glm-z1-flash',
    name: 'GLM-Z1 Flash',
    provider: 'zhipuai',
    category: 'reasoning',
    description: 'تفكير عميق سريع',
    emoji: '⚡🧠',
    supportsTools: true,
    supportsVision: false,
    supportsThinking: true,
    free: false,
  },
];

// ─── Helper Functions ─────────────────────────────────────

export function getModel(id: string): ModelDefinition | undefined {
  return MODELS.find(m => m.id === id);
}

export function getModelOrDefault(id: string): ModelDefinition {
  return getModel(id) || MODELS.find(m => m.id === 'glm-4-flash')!;
}

export function getModelsByCategory(category: ModelDefinition['category']): ModelDefinition[] {
  return MODELS.filter(m => m.category === category);
}

export function getModelsByProvider(provider: Provider): ModelDefinition[] {
  return MODELS.filter(m => m.provider === provider);
}

export function getFreeModels(): ModelDefinition[] {
  return MODELS.filter(m => m.free);
}

export function getVisionModels(): ModelDefinition[] {
  return MODELS.filter(m => m.supportsVision);
}

export function getToolCapableModels(): ModelDefinition[] {
  return MODELS.filter(m => m.supportsTools);
}

export function getCategoryLabel(category: ModelDefinition['category']): string {
  const labels: Record<ModelDefinition['category'], string> = {
    free: '🆓 مجانية',
    language: '💬 لغوية',
    vision: '🖼️ بصرية',
    reasoning: '🧠 استدلال',
    specialized: '🔧 متخصصة',
  };
  return labels[category];
}

/**
 * Get the API base URL for a model's provider
 */
export function getProviderBaseURL(provider: Provider): string {
  switch (provider) {
    case 'opencode':
      return process.env.OPENCODE_BASE_URL || 'https://api.opencode.ai/v1';
    case 'zhipuai':
      return process.env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
    case 'zhipuai-coding':
      return process.env.ZAI_CODING_BASE_URL || 'https://open.bigmodel.cn/api/coding/paas/v4';
    default:
      return process.env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
  }
}

/**
 * Check if a model requires the OpenCode API key
 */
export function requiresOpenCodeKey(modelId: string): boolean {
  const model = getModel(modelId);
  return model?.provider === 'opencode';
}

// ─── Categories for UI ────────────────────────────────────

export const MODEL_CATEGORIES: Array<{
  key: ModelDefinition['category'];
  label: string;
  emoji: string;
}> = [
  { key: 'free', label: 'مجانية', emoji: '🆓' },
  { key: 'language', label: 'لغوية', emoji: '💬' },
  { key: 'vision', label: 'بصرية', emoji: '🖼️' },
  { key: 'reasoning', label: 'استدلال', emoji: '🧠' },
  { key: 'specialized', label: 'متخصصة', emoji: '🔧' },
];
