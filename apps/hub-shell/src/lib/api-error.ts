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
        if (message) {
          if (/last tenant owner/i.test(message)) {
            return message.includes("Cannot")
              ? "无法移除或降级最后一名租户 owner"
              : message;
          }
          if (/last project owner/i.test(message)) {
            return message.includes("Cannot")
              ? `无法移除或降级最后一名项目 owner${message.includes("(") ? message.slice(message.indexOf("(") - 1) : ""}`
              : message;
          }
          if (/already a tenant member/i.test(message)) {
            return "该用户已是租户成员，请在「用户与多空间绑定」中管理";
          }
          if (/already a project member/i.test(message)) {
            return "该用户已绑定当前项目，可通过管理绑定修改角色";
          }
          return message;
        }
        return "操作冲突（例如取消绑定会去掉最后一名 owner）";
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
