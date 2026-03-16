import { WebContainer } from "@webcontainer/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFiles } from "@/features/projects/hooks/use-files";
import { buildFileTree, getFilePath } from "../utils/file-tree";

// Singleton WebContainer instance
let webcontainerInstance: WebContainer | null = null
let bootPromise: Promise<WebContainer> | null = null;

const getWebContainer = async (): Promise<WebContainer> => {
    if (webcontainerInstance) {
        return webcontainerInstance
    }

    if (!bootPromise) {
        bootPromise = WebContainer.boot({ coep: "credentialless" })
    }

    webcontainerInstance = await bootPromise
    return webcontainerInstance
}

const teardownWebContainer = () => {
    if (webcontainerInstance) {
        webcontainerInstance.teardown()
        webcontainerInstance = null
    }
    bootPromise = null
}

interface UsewebContainerProps {
    projectId: Id<"projects">;
    enabled: boolean;
    settings?: {
        installCommand?: string;
        devCommand?: string;
    }
}

const isAbortLikeError = (error: unknown): boolean => {
    if (!error) {
        return false
    }
    if (error instanceof Error) {
        return error.name === "AbortError" || /aborted/i.test(error.message)
    }
    if (typeof error === "object" && error !== null && "name" in error) {
        return String((error as { name?: unknown }).name) === "AbortError"
    }
    return false
}

const parseCommand = (command: string): [string, string[]] => {
    const parts = command.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) {
        return ["", []]
    }
    return [parts[0], parts.slice(1)]
}




export const useWebContainer = ({
    projectId,
    enabled,
    settings,
}: UsewebContainerProps) => {
    const [status, setStatus] = useState
        <
            "idle" | "booting" | "installing" | "running" | "error"
        >
        ("idle");
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [restartKey, setRestartKey] = useState(0);
    const [terminalOutput, setTerminalOutput] = useState("")

    const containerRef = useRef<WebContainer | null>(null);
    const hasStartedRef = useRef(false);

    // Fetch files from Convex (auto-updates on changes)
    const files = useFiles(projectId);
    const hasFiles = Boolean(files && files.length > 0)

    // initial boot and mount
    useEffect(() => {
        if (!enabled || !hasFiles || !files || hasStartedRef.current) {
            return
        }
        hasStartedRef.current = true
        let cancelled = false

        const start = async () => {
            try {
                setStatus("booting")
                setError(null)
                setTerminalOutput("")

                const appendOutput = (data: string) => {
                    setTerminalOutput((prev) => prev + data)
                }

                const container = await getWebContainer()
                if (cancelled) return
                containerRef.current = container

                const fileTree = buildFileTree(files)
                await container.mount(fileTree)
                if (cancelled) return

                container.on("server-ready", (_port, url) => {
                    setPreviewUrl(url)
                    setStatus("running")
                })

                setStatus("installing")
                // Parse install command (default: npm install)
                const installCmd = settings?.installCommand || "npm install"
                const [installBin, installArgs] = parseCommand(installCmd)
                if (!installBin) {
                    throw new Error("Install command is empty")
                }
                appendOutput(`$ ${installCmd}\n`)
                const installProcess = await container.spawn(installBin, installArgs)
                installProcess.output.pipeTo(
                    new WritableStream({
                        write(data) {
                            appendOutput(data)
                        }
                    })
                ).catch((streamError) => {
                    if (!cancelled && !isAbortLikeError(streamError)) {
                        appendOutput(`\n[stream error] ${streamError instanceof Error ? streamError.message : "Unknown stream error"}\n`)
                    }
                })
                const installExitCode = await installProcess.exit
                if (cancelled) return
                if (installExitCode !== 0) {
                    throw new Error(`${installCmd} failed with code ${installExitCode}`);
                }
                // Parse dev command (default: npm run dev)
                const devCmd = settings?.devCommand || "npm run dev";
                const [devBin, devArgs] = parseCommand(devCmd);
                if (!devBin) {
                    throw new Error("Dev command is empty")
                }
                appendOutput(`\n$ ${devCmd}\n`);
                const devProcess = await container.spawn(devBin, devArgs);
                devProcess.output.pipeTo(
                    new WritableStream({
                        write(data) {
                            appendOutput(data);
                        }
                    })
                ).catch((streamError) => {
                    if (!cancelled && !isAbortLikeError(streamError)) {
                        appendOutput(`\n[stream error] ${streamError instanceof Error ? streamError.message : "Unknown stream error"}\n`)
                    }
                })
            } catch (error) {
                if (cancelled || isAbortLikeError(error)) {
                    return
                }
                setError(error instanceof Error ? error.message : "Unknown error")
                setStatus("error")
            }
        }
        start()

        return () => {
            cancelled = true
        }

    }, [
        enabled,
        hasFiles,
        restartKey,
        projectId,
        settings?.devCommand,
        settings?.installCommand
    ])

    //sync file-changes (hot-reload)
    useEffect(() => {
        const container = containerRef.current
        if (!container || !files || status !== "running") return

        const filesMap = new Map(files.map((f) => [f._id, f]))

        for (const file of files) {
            if (file.type !== "file" || file.storageId || !file.content) continue

            const filePath = getFilePath(file, filesMap)
            container.fs.writeFile(filePath, file.content)
        }

    }, [
        files,
        status,
    ])

    // Reset when disabled
    useEffect(() => {
        if (!enabled) {
            hasStartedRef.current = false;
            setStatus("idle");
            setPreviewUrl(null);
            setError(null);
        }
    }, [enabled]);

    // Restart the entire WebContainer process
    const restart = useCallback(() => {
        teardownWebContainer();
        containerRef.current = null;
        hasStartedRef.current = false;
        setStatus("idle");
        setPreviewUrl(null);
        setError(null);
        setRestartKey((k) => k + 1);
    }, []);

    return {
        status,
        previewUrl,
        error,
        restart,
        terminalOutput,
    }
}