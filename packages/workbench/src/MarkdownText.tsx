import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

export function MarkdownText({ text }: { text: string }) {
  return (
    <div className="text-[14px] leading-7 text-[#344054] [&_a]:text-ah-accent [&_code]:rounded [&_code]:bg-[#f2f4f7] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-[#101828] [&_pre]:p-3 [&_pre]:text-[13px] [&_pre]:leading-6 [&_pre]:text-[#e4e7ec] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[#e4e7ec] [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
