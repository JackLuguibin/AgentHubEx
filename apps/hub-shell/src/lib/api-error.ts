export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

function getResponse(err: unknown): Response | null {
  if (
    err &&
    typeof err === "object" &&
    "response" in err &&
    (err as { response: unknown }).response instanceof Response
  ) {
    return (err as { response: Response }).response;
  }
  return null;
}

export async function getApiErrorMessage(
  err: unknown,
  fallback = "操作失败，请稍后重试",
): Promise<string> {
  const response = getResponse(err);
  if (response) {
    try {
      const body = (await response.clone().json()) as ApiErrorBody;
      const code = body.error?.code;
      const message = body.error?.message;
      if (code === "TENANT_SUSPENDED") return message || "租户已停用";
      if (code === "PROJECT_ARCHIVED") return message || "项目已归档";
      if (code === "CONFLICT" || response.status === 409) {
        return message || "操作冲突（资源状态不允许）";
      }
      if (response.status === 403) return message || "没有权限执行此操作";
      if (response.status === 404) return message || "资源不存在";
      if (message) return message;
    } catch {
      /* ignore parse errors */
    }
    return `${fallback}（HTTP ${response.status}）`;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
