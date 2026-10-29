export type Recommendation = 'proceed' | 'review' | 'reject';
export interface ToolCallObservation { readonly id?: string; readonly name: string; readonly argumentBytes: number; readonly complete: boolean; }
export interface FinalEvidence { readonly finishReason?: string; readonly outputTokens?: number; readonly maxOutputTokens?: number; }
export interface AuditIssue { readonly code: string; readonly severity: 'warning' | 'error'; readonly call: number; readonly message: string; readonly [key: string]: unknown; }
export interface AuditSnapshot { readonly callCount: number; readonly completeCalls: number; readonly incompleteCalls: number; readonly argumentBytes: number; readonly droppedCalls: number; readonly issueCount: number; readonly errorIssueCount: number; readonly warningIssueCount: number; readonly retainedIssueCount: number; readonly droppedIssues: number; readonly finalized: boolean; }
export interface ObserveResult { readonly status: 'accepted' | 'rejected'; readonly issues: readonly AuditIssue[]; readonly snapshot: AuditSnapshot; }
export interface FinalReport { readonly valid: boolean; readonly recommendation: Recommendation; readonly issues: readonly AuditIssue[]; readonly snapshot: AuditSnapshot; }
export interface ToolCallBudgetAuditOptions { readonly maxCalls?: number; readonly maxArgumentBytes?: number; readonly maxBatchBytes?: number; readonly maxIssues?: number; readonly maxIdLength?: number; readonly warningRatio?: number; }
export interface ToolCallBudgetAudit { observe(call: ToolCallObservation): ObserveResult; snapshot(): AuditSnapshot; finalize(evidence?: FinalEvidence): FinalReport; }
export declare function createToolCallBudgetAudit(options?: ToolCallBudgetAuditOptions): ToolCallBudgetAudit;
declare const api: { createToolCallBudgetAudit: typeof createToolCallBudgetAudit };
export default api;
