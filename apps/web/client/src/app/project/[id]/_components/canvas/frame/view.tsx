'use client';

import type { IframeHTMLAttributes } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { connect, WindowMessenger } from 'penpal';

import type { Frame } from '@onlook/models';
import type {
    PenpalChildMethods,
    PenpalParentMethods,
    PromisifiedPendpalChildMethods,
} from '@onlook/penpal';
import { PENPAL_PARENT_CHANNEL } from '@onlook/penpal';
import { WebPreview, WebPreviewBody } from '@onlook/ui/ai-elements';
import { Icons } from '@onlook/ui/icons';
import { ProgressWithInterval } from '@onlook/ui/progress-with-interval';
import { cn } from '@onlook/ui/utils';

import { useEditorEngine } from '@/components/store/editor';

export type IFrameView = HTMLIFrameElement & {
    setZoomLevel: (level: number) => void;
    supportsOpenDevTools: () => boolean;
    reload: () => void;
    isLoading: () => boolean;
} & PromisifiedPendpalChildMethods;

// Creates a proxy that provides safe fallback methods for any property access
const createSafeFallbackMethods = (): PromisifiedPendpalChildMethods => {
    return new Proxy({} as PromisifiedPendpalChildMethods, {
        get(_target, prop: string | symbol) {
            if (typeof prop === 'symbol') return undefined;

            return async (..._args: any[]) => {
                const method = String(prop);
                if (
                    method.startsWith('get') ||
                    method.includes('capture') ||
                    method.includes('build')
                ) {
                    return null;
                }
                if (method.includes('Count')) {
                    return 0;
                }
                if (method.includes('Editable') || method.includes('supports')) {
                    return false;
                }
                return undefined;
            };
        },
    });
};

interface FrameViewProps extends IframeHTMLAttributes<HTMLIFrameElement> {
    frame: Frame;
    reloadIframe: () => void;
    onConnectionFailed: () => void;
    onConnectionSuccess: () => void;
    penpalTimeoutMs?: number;
    isInDragSelection?: boolean;
}

export const FrameComponent = observer(
    forwardRef<IFrameView, FrameViewProps>(
        (
            {
                frame,
                reloadIframe,
                onConnectionFailed,
                onConnectionSuccess,
                penpalTimeoutMs = 5000,
                isInDragSelection = false,
                ...restProps
            },
            ref,
        ) => {
            const { popover, ...props } = restProps;
            const editorEngine = useEditorEngine();
            const iframeRef = useRef<HTMLIFrameElement>(null);
            const zoomLevel = useRef(1);
            const isConnecting = useRef(false);
            const connectionRef = useRef<ReturnType<typeof connect> | null>(null);
            const [penpalChild, setPenpalChild] = useState<PenpalChildMethods | null>(null);
            const isSelected = editorEngine.frames.isSelected(frame.id);
            const isActiveBranch = editorEngine.branches.activeBranch.id === frame.branchId;

            const setupPenpalConnection = () => {
                try {
                    if (!iframeRef.current?.contentWindow) {
                        console.error(`${PENPAL_PARENT_CHANNEL} (${frame.id}) - No iframe found`);
                        onConnectionFailed();
                        return;
                    }

                    if (isConnecting.current) {
                        console.log(
                            `${PENPAL_PARENT_CHANNEL} (${frame.id}) - Connection already in progress`,
                        );
                        return;
                    }
                    isConnecting.current = true;

                    // Destroy any existing connection
                    if (connectionRef.current) {
                        connectionRef.current.destroy();
                        connectionRef.current = null;
                        setPenpalChild(null);
                    }

                    const messenger = new WindowMessenger({
                        remoteWindow: iframeRef.current.contentWindow,
                        allowedOrigins: ['*'],
                    });

                    const connection = connect({
                        messenger,
                        methods: {
                            getFrameId: () => frame.id,
                            getBranchId: () => frame.branchId,
                            onWindowMutated: () => {
                                editorEngine.frameEvent.handleWindowMutated();
                            },
                            onWindowResized: () => {
                                editorEngine.frameEvent.handleWindowResized();
                            },
                            onDomProcessed: (data: {
                                layerMap: Record<string, any>;
                                rootNode: any;
                            }) => {
                                editorEngine.frameEvent.handleDomProcessed(frame.id, data);
                            },
                        } satisfies PenpalParentMethods,
                    });

                    connectionRef.current = connection;

                    // Create a timeout promise that rejects after specified timeout
                    const timeoutPromise = new Promise<never>((_, reject) => {
                        setTimeout(() => {
                            reject(
                                new Error(`Penpal connection timeout after ${penpalTimeoutMs}ms`),
                            );
                        }, penpalTimeoutMs);
                    });

                    console.log(`${PENPAL_PARENT_CHANNEL} (${frame.id}) - Handshake starting...`);
                    // Race the connection promise against the timeout
                    Promise.race([connection.promise, timeoutPromise])
                        .then((child) => {
                            isConnecting.current = false;
                            if (!child) {
                                console.error(
                                    `${PENPAL_PARENT_CHANNEL} (${frame.id}) - Connection failed: child is null`,
                                );
                                onConnectionFailed();
                                return;
                            }

                            console.log(
                                `${PENPAL_PARENT_CHANNEL} (${frame.id}) - Penpal connection set`,
                            );

                            const remote = child as unknown as PenpalChildMethods;
                            setPenpalChild(remote);
                            remote.setFrameId(frame.id);
                            remote.setBranchId(frame.branchId);
                            remote.handleBodyReady();
                            remote.processDom();

                            // Notify parent of successful connection
                            onConnectionSuccess();
                        })
                        .catch((error) => {
                            isConnecting.current = false;
                            console.error(
                                `${PENPAL_PARENT_CHANNEL} (${frame.id}) - Failed to setup penpal connection:`,
                                error,
                            );
                            onConnectionFailed();
                        });
                } catch (error) {
                    isConnecting.current = false;
                    console.error(`${PENPAL_PARENT_CHANNEL} (${frame.id}) - Setup failed:`, error);
                    onConnectionFailed();
                }
            };
 
            const handleOnLoad = () => {
                setupPenpalConnection();
                editorEngine.frames.reportFrameLoaded();
            };

            const promisifyMethod = <T extends (...args: any[]) => any>(
                method: T | undefined,
            ): ((...args: Parameters<T>) => Promise<ReturnType<T>>) => {
                return async (...args: Parameters<T>) => {
                    try {
                        if (!method) throw new Error('Method not initialized');
                        return method(...args);
                    } catch (error) {
                        console.error(
                            `${PENPAL_PARENT_CHANNEL} (${frame.id}) - Method failed:`,
                            error,
                        );
                    }
                };
            };

            const remoteMethods = useMemo((): PromisifiedPendpalChildMethods => {
                const promisify = <K extends keyof PromisifiedPendpalChildMethods>(
                    key: K,
                ): PromisifiedPendpalChildMethods[K] => {
                    return (async (...args: any[]) => {
                        try {
                            if (penpalChild && (penpalChild as any)[key]) {
                                return (penpalChild as any)[key](...args);
                            }
                            const fallback = createSafeFallbackMethods();
                            return (fallback as any)[key](...args);
                        } catch (error) {
                            if (error instanceof Error && error.message.includes('destroyed')) {
                                console.warn(`${PENPAL_PARENT_CHANNEL} (${frame.id}) - Connection destroyed while calling ${key}, using fallback.`);
                                const fallback = createSafeFallbackMethods();
                                return (fallback as any)[key](...args);
                            }
                            console.error(
                                `${PENPAL_PARENT_CHANNEL} (${frame.id}) - Method ${key} failed:`,
                                error,
                            );
                        }
                    }) as unknown as PromisifiedPendpalChildMethods[K];
                };

                return {
                    processDom: promisify('processDom'),
                    getElementAtLoc: promisify('getElementAtLoc'),
                    getElementByDomId: promisify('getElementByDomId'),
                    setFrameId: promisify('setFrameId'),
                    setBranchId: promisify('setBranchId'),
                    getElementIndex: promisify('getElementIndex'),
                    getComputedStyleByDomId: promisify('getComputedStyleByDomId'),
                    updateElementInstance: promisify('updateElementInstance'),
                    getFirstOnlookElement: promisify('getFirstOnlookElement'),
                    setElementType: promisify('setElementType'),
                    getElementType: promisify('getElementType'),
                    getParentElement: promisify('getParentElement'),
                    getChildrenCount: promisify('getChildrenCount'),
                    getOffsetParent: promisify('getOffsetParent'),
                    getActionLocation: promisify('getActionLocation'),
                    getActionElement: promisify('getActionElement'),
                    getInsertLocation: promisify('getInsertLocation'),
                    getRemoveAction: promisify('getRemoveAction'),
                    getTheme: promisify('getTheme'),
                    setTheme: promisify('setTheme'),
                    startDrag: promisify('startDrag'),
                    drag: promisify('drag'),
                    dragAbsolute: promisify('dragAbsolute'),
                    endDragAbsolute: promisify('endDragAbsolute'),
                    endDrag: promisify('endDrag'),
                    endAllDrag: promisify('endAllDrag'),
                    startEditingText: promisify('startEditingText'),
                    editText: promisify('editText'),
                    stopEditingText: promisify('stopEditingText'),
                    updateStyle: promisify('updateStyle'),
                    insertElement: promisify('insertElement'),
                    removeElement: promisify('removeElement'),
                    moveElement: promisify('moveElement'),
                    groupElements: promisify('groupElements'),
                    ungroupElements: promisify('ungroupElements'),
                    insertImage: promisify('insertImage'),
                    removeImage: promisify('removeImage'),
                    isChildTextEditable: promisify('isChildTextEditable'),
                    handleBodyReady: promisify('handleBodyReady'),
                    captureScreenshot: promisify('captureScreenshot'),
                    buildLayerTree: promisify('buildLayerTree'),
                };
            }, [penpalChild]);

            useImperativeHandle(ref, (): IFrameView => {
                const iframe = iframeRef.current;
                if (!iframe) {
                    console.error(`${PENPAL_PARENT_CHANNEL} (${frame.id}) - Iframe - Not found`);
                    // Return safe fallback with no-op methods and safe defaults
                    const fallbackElement = document.createElement('iframe');
                    const safeFallback: IFrameView = Object.assign(fallbackElement, {
                        // Custom sync methods with safe no-op implementations
                        supportsOpenDevTools: () => false,
                        setZoomLevel: () => { },
                        reload: () => { },
                        isLoading: () => false,
                        // Reuse the safe fallback methods from remoteMethods
                        ...remoteMethods,
                    });
                    return safeFallback;
                }

                // Register the iframe with the editor engine
                editorEngine.frames.registerView(frame, iframe as IFrameView);

                const syncMethods = {
                    supportsOpenDevTools: () =>
                        !!iframe.contentWindow && 'openDevTools' in iframe.contentWindow,
                    setZoomLevel: (level: number) => {
                        zoomLevel.current = level;
                        iframe.style.transform = `scale(${level})`;
                        iframe.style.transformOrigin = 'top left';
                    },
                    reload: () => reloadIframe(),
                    isLoading: () => iframe.contentDocument?.readyState !== 'complete',
                };

                if (!penpalChild) {
                    console.warn(
                        `${PENPAL_PARENT_CHANNEL} (${frame.id}) - Failed to setup penpal connection: iframeRemote is null`,
                    );
                    return Object.assign(iframe, syncMethods, remoteMethods) as IFrameView;
                }

                return Object.assign(iframe, {
                    ...syncMethods,
                    ...remoteMethods,
                });
            }, [penpalChild, frame, iframeRef]);

            useEffect(() => {
                return () => {
                    if (connectionRef.current) {
                        connectionRef.current.destroy();
                        connectionRef.current = null;
                    }
                    setPenpalChild(null);
                    isConnecting.current = false;
                };
            }, []);

            return (
                <WebPreview>
                    <WebPreviewBody
                        ref={iframeRef}
                        id={frame.id}
                        className={cn(
                            'outline outline-4 backdrop-blur-sm transition',
                            isActiveBranch && 'outline-teal-400',
                            isActiveBranch && !isSelected && 'outline-dashed',
                            !isActiveBranch && isInDragSelection && 'outline-teal-500',
                        )}
                        src={useMemo(() => {
                            if (frame.url.includes('csb.app')) {
                                // Prefer the signed URL if available from the session, as it bypasses the security gateway
                                const sandbox = editorEngine.branches.getSandboxById(frame.branchId);
                                if (sandbox?.session.signedPreviewUrl) {
                                    return sandbox.session.signedPreviewUrl;
                                }

                                try {
                                    const url = new URL(frame.url);
                                    url.searchParams.set('v', '1');
                                    url.searchParams.set('wait', '1');
                                    url.searchParams.set('preview', '1');
                                    url.searchParams.set('from-embed', '1');
                                    url.searchParams.set('standalone', '1');
                                    url.searchParams.set('run', '1');
                                    return url.toString();
                                } catch (e) {
                                    let newUrl = frame.url;
                                    const params = ['v=1', 'wait=1', 'preview=1', 'from-embed=1', 'standalone=1', 'run=1'];
                                    for (const param of params) {
                                        if (!newUrl.includes(param)) {
                                            newUrl += (newUrl.includes('?') ? '&' : '?') + param;
                                        }
                                    }
                                    return newUrl;
                                }
                            }
                            return frame.url;
                        }, [frame.url, editorEngine.branches.getSandboxById(frame.branchId)?.session.signedPreviewUrl])}
                        sandbox="allow-modals allow-forms allow-same-origin allow-scripts allow-popups allow-downloads"
                        allow="geolocation; microphone; camera; midi; encrypted-media"
                        style={{ width: frame.dimension.width, height: frame.dimension.height }}
                        onLoad={handleOnLoad}
                        {...props}
                    />
                    {editorEngine.frames.isReloading && (
                        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-50">
                            <div className="w-full max-w-xs space-y-4">
                                <Icons.LoadingSpinner className="h-8 w-8 animate-spin mx-auto text-primary" />
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-foreground">
                                        {editorEngine.frames.loadingMessage || 'Reloading...'}
                                    </p>
                                    <ProgressWithInterval
                                        isLoading={true}
                                        className="h-1"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </WebPreview>
            );
        },
    ),
);
