'use client';

import React, { useEffect, useRef, useId } from 'react';

interface AccessibleDialogProps {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  /** Use "alertdialog" for destructive confirmations */
  role?: 'dialog' | 'alertdialog';
  /** CSS class for the overlay */
  overlayClassName?: string;
  /** CSS class for the dialog container */
  dialogClassName?: string;
  /** Optional description element id for aria-describedby */
  descriptionId?: string;
}

export default function AccessibleDialog({
  children,
  onClose,
  title,
  role = 'dialog',
  overlayClassName,
  dialogClassName,
  descriptionId,
}: AccessibleDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;

    // Focus first focusable element in dialog
    const focusableSelector =
      'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
    const dialog = dialogRef.current;
    if (dialog) {
      const firstFocusable = dialog.querySelector<HTMLElement>(focusableSelector);
      if (firstFocusable) {
        firstFocusable.focus();
      }
    }

    return () => {
      // Return focus on close
      if (previousFocus.current && previousFocus.current.focus) {
        previousFocus.current.focus();
      }
    };
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key === 'Tab') {
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusableSelector =
        'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector)
      ).filter((el) => !el.hasAttribute('disabled'));

      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    }
  }

  return (
    <div
      className={overlayClassName}
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        className={dialogClassName}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(e) => e.stopPropagation()}
      >
        <span id={titleId} className="sr-only">
          {title}
        </span>
        {children}
      </div>
    </div>
  );
}
