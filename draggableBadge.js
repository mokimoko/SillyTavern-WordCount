// Pointer dragging for the Word Count badge, with click/drag disambiguation.

const EDGE_GAP = 8;
const DRAG_THRESHOLD = 4;

export function makeDraggableBadge(element, { readPosition, writePosition, onClick }) {
    if (!element || element.dataset.wcDraggable === 'true') return;
    element.dataset.wcDraggable = 'true';

    let drag = null;
    let suppressClick = false;
    let suppressTimer = null;

    const clamp = (x, y) => ({
        x: Math.max(EDGE_GAP, Math.min(x, window.innerWidth - element.offsetWidth - EDGE_GAP)),
        y: Math.max(EDGE_GAP, Math.min(y, window.innerHeight - element.offsetHeight - EDGE_GAP)),
    });
    const setPosition = (x, y) => {
        const position = clamp(x, y);
        element.style.left = `${Math.round(position.x)}px`;
        element.style.top = `${Math.round(position.y)}px`;
        element.style.right = 'auto';
        element.style.bottom = 'auto';
        return position;
    };
    const applySavedPosition = () => {
        const position = readPosition?.();
        if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
            setPosition(position.x, position.y);
        }
    };

    element.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const rect = element.getBoundingClientRect();
        drag = {
            pointerId: event.pointerId,
            pointerX: event.clientX,
            pointerY: event.clientY,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            moved: false,
        };
        element.setPointerCapture?.(event.pointerId);
    });

    element.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (!drag.moved) {
            const distance = Math.hypot(event.clientX - drag.pointerX, event.clientY - drag.pointerY);
            if (distance < DRAG_THRESHOLD) return;
            drag.moved = true;
            element.classList.add('wc-dragging');
        }
        event.preventDefault();
        setPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    });

    const endDrag = event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (element.hasPointerCapture?.(drag.pointerId)) element.releasePointerCapture(drag.pointerId);
        if (drag.moved) {
            const rect = element.getBoundingClientRect();
            const position = setPosition(rect.left, rect.top);
            writePosition?.(position);
            suppressClick = true;
            clearTimeout(suppressTimer);
            suppressTimer = setTimeout(() => { suppressClick = false; }, 250);
        }
        drag = null;
        element.classList.remove('wc-dragging');
    };

    element.addEventListener('pointerup', endDrag);
    element.addEventListener('pointercancel', endDrag);
    element.addEventListener('click', event => {
        if (suppressClick) {
            suppressClick = false;
            clearTimeout(suppressTimer);
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        onClick?.();
    });
    window.addEventListener('resize', () => {
        if (element.style.left) {
            const rect = element.getBoundingClientRect();
            setPosition(rect.left, rect.top);
        }
    });

    requestAnimationFrame(applySavedPosition);
}
