import { defineTool } from '@lovable.dev/mcp-js';
import { appwriteUnifiedClient as supabase } from '@/integrations/appwrite/adapter';
import { z } from 'zod';

export default defineTool({
  name: 'list_recent_gate_entries',
  title: 'List recent gate entries',
  description: 'Returns recent gate entry events with recognition status.',
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    limit: z.number().optional().describe('How many recent gate entries to return (default 20).'),
  },
  handler: async ({ limit = 20 }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return {
        content: [{ type: 'text', text: 'Not authenticated.' }],
        isError: true,
      };
    }

    try {
      const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

      const { data, error } = await supabase
        .from('gate_entries')
        .select('id, student_id, student_name, is_recognized, confidence_score, gate_name, entry_time, class, section')
        .order('entry_time', { ascending: false })
        .limit(safeLimit);

      if (error) {
        return {
          content: [{ type: 'text', text: `Query failed: ${error.message}` }],
          isError: true,
        };
      }

      const rows = (data || []).map((row: any) => ({
        id: row.id,
        student_id: row.student_id,
        student_name: row.student_name,
        recognized: row.is_recognized,
        confidence: row.confidence_score,
        gate_name: row.gate_name,
        entry_time: row.entry_time,
        class: row.class,
        section: row.section,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
        structuredContent: { entries: rows },
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: error?.message || 'Failed to fetch gate entries.' }],
        isError: true,
      };
    }
  },
});
