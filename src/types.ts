export type Track = 'IELTS' | 'Full Stack' | 'Thesis' | 'Routine';
export type Task = { id: string; user_id: string; track: Track; title: string; description: string; due_date: string; day_number: number | null; is_completed: boolean; completed_at: string | null; estimated_minutes: number; created_at?: string };
