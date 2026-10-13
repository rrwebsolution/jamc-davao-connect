"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Popover } from "@base-ui/react/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "cn";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

type Option = { value: string; label: string; disabled: boolean };

/** Reads the <option> children exactly as a native <select> would. */
function readOptions(children: ReactNode, into: Option[] = []): Option[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: unknown; children?: ReactNode; disabled?: boolean };
    if (child.type === Fragment) {
      readOptions(props.children, into);
    } else if (child.type === "option") {
      const label = Children.toArray(props.children).join("");
      into.push({ value: String(props.value ?? label), label, disabled: Boolean(props.disabled) });
    }
  });
  return into;
}

const SEARCH_FROM = 7;

/**
 * A command-style picker (searchable list in a popover) that behaves like a
 * native <select>: same props, same <option> children, same change events.
 * A real, visually hidden <select> stays in the DOM and holds the value, so
 * react-hook-form's register(), controlled value/onChange and form submission
 * all keep working unchanged.
 */
export function CommandSelect({
  className,
  children,
  id,
  disabled,
  ref,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  ...selectProps
}: ComponentProps<"select">) {
  const options = readOptions(children);
  const [open, setOpen] = useState(false);
  const selectRef = useRef<HTMLSelectElement | null>(null);

  const setRefs = useCallback(
    (element: HTMLSelectElement | null) => {
      selectRef.current = element;
      if (typeof ref === "function") ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );

  // The hidden select is the source of truth for the current value.
  const fallback = String(selectProps.value ?? selectProps.defaultValue ?? options[0]?.value ?? "");
  const subscribe = useCallback((onChange: () => void) => {
    const element = selectRef.current;
    element?.addEventListener("change", onChange);
    return () => element?.removeEventListener("change", onChange);
  }, []);
  const current = useSyncExternalStore(
    subscribe,
    () => selectRef.current?.value ?? fallback,
    () => fallback,
  );
  const selected = options.find((option) => option.value === current);

  function choose(value: string) {
    const element = selectRef.current;
    if (element && element.value !== value) {
      element.value = value;
      // Tell React (and react-hook-form) just as a user picking an option would.
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setOpen(false);
  }

  return (
    <>
      <select ref={setRefs} disabled={disabled} tabIndex={-1} aria-hidden className="sr-only" {...selectProps}>
        {children}
      </select>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          className={cn(
            "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none transition-colors max-md:h-11 max-md:px-3 max-md:text-base",
            "hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:border-ring",
            "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30",
            className,
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.label ?? "Select…"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </Popover.Trigger>
        <Popover.Portal>
          {/* Phones: the list opens as a sheet from the bottom, with the page dimmed behind it. */}
          <Popover.Backdrop className="fixed inset-0 z-[69] bg-black/30 md:hidden" />
          <Popover.Positioner
            sideOffset={4}
            align="start"
            className="z-[70] max-md:fixed! max-md:inset-x-0! max-md:top-auto! max-md:bottom-0! max-md:left-0! max-md:w-full! max-md:transform-none!"
          >
            <Popover.Popup className="w-(--anchor-width) min-w-56 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none max-md:w-full max-md:max-w-none max-md:rounded-b-none max-md:rounded-t-2xl max-md:border-x-0 max-md:border-b-0 max-md:pb-[env(safe-area-inset-bottom)] max-md:data-open:zoom-in-100 max-md:data-open:slide-in-from-bottom-6">
              <Command loop defaultValue={selected ? `${selected.label} ${selected.value}` : undefined}>
                {ariaLabel ? <p className="border-b px-4 py-3 text-sm font-semibold md:hidden">{ariaLabel}</p> : null}
                {options.length >= SEARCH_FROM ? <CommandInput placeholder="Search…" className="h-10 max-md:h-12" autoFocus /> : null}
                <CommandList className="max-h-64 max-md:max-h-[60dvh] sm:max-h-64">
                  <CommandEmpty>No match found.</CommandEmpty>
                  <CommandGroup>
                    {options.map((option) => (
                      <CommandItem
                        key={option.value}
                        value={`${option.label} ${option.value}`}
                        disabled={option.disabled}
                        onSelect={() => choose(option.value)}
                      >
                        <span className="flex-1 truncate">{option.label}</span>
                        {option.value === current ? <Check className="text-foreground" aria-hidden /> : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
