import { useEffect, useRef } from 'react';

export function useDialogFocus(active, onClose) {
    const dialogRef = useRef(null);
    const closeRef = useRef(onClose);
    useEffect(() => { closeRef.current = onClose; }, [onClose]);

    useEffect(() => {
        if (!active) return undefined;
        const dialog = dialogRef.current;
        const previousFocus = document.activeElement;
        const focusable = () => Array.from(dialog?.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []).filter(element => element.getClientRects().length > 0);
        (focusable()[0] || dialog)?.focus();

        const handleKeyDown = (event) => {
            const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
            if (dialogs[dialogs.length - 1] !== dialog) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeRef.current?.();
            }
            if (event.key !== 'Tab') return;
            const elements = focusable();
            if (!elements.length) {
                event.preventDefault();
                dialog?.focus();
                return;
            }
            const first = elements[0];
            const last = elements[elements.length - 1];
            if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            previousFocus?.focus?.();
        };
    }, [active]);

    return dialogRef;
}
