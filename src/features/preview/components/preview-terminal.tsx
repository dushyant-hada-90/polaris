"use client"
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css"
import { useEffect, useRef } from "react";

interface PreviewTerminalProps {
    output: string
}

export const PreviewTerminal = ({ output }: PreviewTerminalProps) => {
    const fitAddonRef = useRef<FitAddon | null>(null);
    const lastLengthRef = useRef(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null)

    // initialize the terminal
    useEffect(() => {
        if (!containerRef.current || terminalRef.current) return

        const terminal = new Terminal({
            convertEol: true,
            disableStdin: true,
            fontSize: 12,
            fontFamily: "monospace",
            theme: { background: "#1f2228" },
        })

        const fitAddon = new FitAddon()
        terminal.loadAddon(fitAddon)
        terminal.open(containerRef.current)

        terminalRef.current = terminal
        fitAddonRef.current = fitAddon

        // Write existing output on mount
        if (output) {
            terminal.write(output);
            lastLengthRef.current = output.length;
        }

        requestAnimationFrame(() => fitAddon.fit())
        const resizeObserver = new ResizeObserver(() => fitAddon.fit())
        resizeObserver.observe(containerRef.current)

        return () => {
            resizeObserver.disconnect();
            terminal.dispose();
            terminalRef.current = null;
            fitAddonRef.current = null;
        }
        // output is not needed to be in dependency array since it is not indented to undate anything, just used on mount
    }, [])

    // Write Output
    useEffect(() => {
        if (!terminalRef.current) return;

        if (output.length < lastLengthRef.current) {
            terminalRef.current.clear();
            lastLengthRef.current = 0;
        }

        const newData = output.slice(lastLengthRef.current);
        if (newData) {
            terminalRef.current.write(newData);
            lastLengthRef.current = output.length;
        }
    }, [output])

    return (
        <div
            ref={containerRef}
            className="flex-1 min-h-0 p-3 [&_.xterm]:h-full! [&_.xterm-viewport]:h-full! [&_.xterm-screen]:h-full! bg-sidebar"
        />
    )
}
