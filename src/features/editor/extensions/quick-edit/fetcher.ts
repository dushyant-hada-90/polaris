import z from "zod";
import ky from "ky";
import { toast } from "sonner";

const editRequestSchema = z.object({
selectedCode: z.string(),
fullCode: z.string(),
instruction: z.string(),
})

const editResponseSchema = z.object({
    edit: z.string(),
})

type editRequest = z.infer<typeof editRequestSchema>
type editResponse = z.infer<typeof editResponseSchema>


export const fetcher = async (
    payload: editRequest,
    signal: AbortSignal,
): Promise<string | null> => {
    try {
        const validatedPayload = editRequestSchema.parse(payload)

        const response = await ky
            .post("/api/quick-edit", {
                json: validatedPayload,
                signal,
                timeout: 30_000,
                retry: 0
            })
            .json<editResponse>()

        const validatedResponse = editResponseSchema.parse(response)

        return validatedResponse.edit || null
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            return null;
        }
        console.log(error)
        toast.error(`Failed to fetch AI quick edit ${error}`);
        return null
    }
}