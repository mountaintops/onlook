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
import { SystemTheme } from '@onlook/models';
import { Icons } from '@onlook/ui/icons';
import { ProgressWithInterval } from '@onlook/ui/progress-with-interval';
import { cn } from '@onlook/ui/utils';

import { useEditorEngine } from '@/components/store/editor';

export type IFrameView = HTMLIFrameElement & {
    setZoomLevel: (level: number) => void;
    supportsOpenDevTools: () => boolean;
    reload: () => void;
    isLoading: () => boolean;
    updateCssVariable: (name: string, value: string) => Promise<void>;
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
                penpalTimeoutMs = 10000,
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
                        onConnectionFailed();
                        return;
                    }

                    if (isConnecting.current) {
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

                    // Race the connection promise against the timeout
                    Promise.race([connection.promise, timeoutPromise])
                        .then((child) => {
                            isConnecting.current = false;
                            if (!child) {
                                onConnectionFailed();
                                return;
                            }


                            const remote = child as unknown as PenpalChildMethods;
                            setPenpalChild(remote);
                            remote.setFrameId(frame.id);
                            remote.setBranchId(frame.branchId);
                            remote.handleBodyReady();
                            remote.processDom();

                            // Delay initial theme application to avoid hydration mismatch
                            setTimeout(() => {
                                try {
                                    remote.setTheme((frame.theme as unknown as SystemTheme) || SystemTheme.SYSTEM);
                                } catch (error) {
                                    // Ignore PenpalError if connection was destroyed
                                    console.warn('[FrameView] Failed to set theme due to connection state:', error);
                                }
                            }, 500);

                            // Notify parent of successful connection
                            onConnectionSuccess();
                        })
                        .catch((error) => {
                            isConnecting.current = false;
                            onConnectionFailed();
                        });
                } catch (error) {
                    isConnecting.current = false;
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
                        // Suppressed Penpal method error
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
                                // Must await here to catch the error in this try block
                                return await (penpalChild as any)[key](...args);
                            }
                            const fallback = createSafeFallbackMethods();
                            return await (fallback as any)[key](...args);
                        } catch (error: any) {
                            const isConnectionError =
                                error instanceof Error &&
                                (error.message.includes('destroyed') ||
                                    error.name === 'PenpalError' ||
                                    error.constructor?.name === 'PenpalError');

                            if (isConnectionError) {
                                const fallback = createSafeFallbackMethods();
                                return await (fallback as any)[key](...args);
                            }
                            console.error(`Penpal method ${String(key)} failed:`, error);
                            return undefined;
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
                    updateCssVariable: promisify('updateCssVariable'),
                };

            }, [penpalChild]);

            useImperativeHandle(ref, (): IFrameView => {
                const iframe = iframeRef.current;
                if (!iframe) {
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

                const augmentedIframe = Object.assign(iframe, {
                    ...syncMethods,
                    ...remoteMethods,
                }) as IFrameView;

                // Register the iframe with the editor engine
                editorEngine.frames.registerView(frame, augmentedIframe);

                return augmentedIframe;
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
                <div className="relative">
                    <iframe
                        ref={iframeRef}
                        id={frame.id}
                        className={cn(
                            'outline outline-4 transition block',
                            isActiveBranch && 'outline-teal-400',
                            isActiveBranch && !isSelected && 'outline-dashed',
                            !isActiveBranch && isInDragSelection && 'outline-teal-500',
                        )}
                        src={useMemo(() => {
                            // Validate URL - data URIs are not supported for iframe src
                            if (frame.url.startsWith('data:')) {
                                console.error('[Frame] Data URIs are not supported for iframe src. URL:', frame.url);
                                return 'about:blank';
                            }

                            if (frame.url.includes('csb.app')) {
                                // Prefer the signed URL if available from the session, as it bypasses the security gateway
                                const sandbox = editorEngine.branches.getSandboxById(frame.branchId);
                                if (sandbox?.session.signedPreviewUrl) {
                                    // Validate signed preview URL
                                    if (sandbox.session.signedPreviewUrl.startsWith('data:')) {
                                        console.error('[Frame] Data URIs are not supported for signed preview URL');
                                        return 'about:blank';
                                    }

                                    console.log('[Frame] Using signed preview URL to bypass security gateway');
                                    try {
                                        const originalUrl = new URL(frame.url);
                                        const signedUrl = new URL(sandbox.session.signedPreviewUrl);
                                        signedUrl.pathname = originalUrl.pathname;
                                        signedUrl.search = originalUrl.search;
                                        signedUrl.hash = originalUrl.hash;
                                        return signedUrl.toString();
                                    } catch (e) {
                                        console.warn('[Frame] Error constructing signed URL:', e);
                                        return sandbox.session.signedPreviewUrl;
                                    }
                                }

                                // Fallback to regular URL with parameters
                                try {
                                    const url = new URL(frame.url);
                                    url.searchParams.set('v', '1');
                                    url.searchParams.set('wait', '1');
                                    url.searchParams.set('preview', '1');
                                    url.searchParams.set('from-embed', '1');
                                    url.searchParams.set('standalone', '1');
                                    url.searchParams.set('run', '1');
                                    console.log('[Frame] Using regular URL with preview parameters');
                                    return url.toString();
                                } catch (e) {
                                    console.warn('[Frame] Error constructing URL:', e);
                                    return frame.url;
                                }
                            }
                            return frame.url;
                        }, [frame.url, editorEngine.branches.getSandboxById(frame.branchId)?.session.signedPreviewUrl])}
                        sandbox="allow-modals allow-forms allow-same-origin allow-scripts allow-popups allow-downloads"
                        allow="geolocation; microphone; camera; midi; encrypted-media"
                        referrerPolicy="no-referrer-when-downgrade"
                        style={{ width: frame.dimension.width, height: frame.dimension.height, backdropFilter: 'blur(0px)' }}
                        onLoad={handleOnLoad}
                        {...props}
                    />
                    {editorEngine.frames.isReloading && (
                        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-50"
                            style={{ width: frame.dimension.width, height: frame.dimension.height }}
                        >
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
                </div>
            );
        },
    ),
);
