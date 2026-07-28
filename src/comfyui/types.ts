// Pure type definitions for ComfyUI Cloud API shapes.
// ZERO imports — canonical type source for src/comfyui/**.

export interface SubmitRequest {
  prompt: Record<string, unknown>;
  extra_data?: Record<string, unknown>;
}

export interface SubmitResponse {
  prompt_id: string;
  // other fields from ComfyUI intentionally ignored
}

export interface ComfyOutput {
  filename: string;
  subfolder?: string;
  type?: string;
}

export interface StatusResponse {
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  outputs?: ComfyOutput[];
  error?: unknown;
}

export interface StoredOutput {
  filename: string;
  path: string;
  url: string;
  content_type: string;
  size_bytes: number;
}

export interface NodeError {
  errors: Array<{ type: string; message: string; details?: string; extra_info?: unknown }>;
  dependent_outputs: string[];
  class_type: string;
}
