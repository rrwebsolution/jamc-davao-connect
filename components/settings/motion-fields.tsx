"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, FormSection, NativeSelect } from "@/components/shared/form";
import { motionLevel, scrollRevealOn, type MotionLevel, type MotionSettings } from "@/lib/motion";

type SetMotion = <K extends keyof MotionSettings>(key: K, value: MotionSettings[K]) => void;

const LEVELS: { value: MotionLevel; label: string; note: string }[] = [
  { value: "off", label: "Off", note: "No entrance or hover animations. Spinners and the loading bar still move." },
  { value: "subtle", label: "Subtle (recommended)", note: "Small, quick movements." },
  { value: "normal", label: "Normal", note: "A little more noticeable, still calm." },
];

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 text-sm ${disabled ? "opacity-60" : ""}`}>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
      <span>
        {label}
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Appearance → Motion & animation. The sample plays with the level being
 * edited; the rest of the system follows after saving.
 */
export function MotionSection({ values, set }: { values: MotionSettings; set: SetMotion }) {
  const level = motionLevel(values);
  const reveal = scrollRevealOn(values);
  // Replaying remounts the sample so its entrance animation runs again.
  const [run, setRun] = useState(0);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <FormSection title="Motion & animation" description="How much the interface moves. Animations never delay navigation or loading, and are skipped on devices set to reduce motion.">
        <div className="space-y-4">
          <Toggle
            checked={values.animations_enabled}
            onChange={(checked) => set("animations_enabled", checked)}
            label="System animations"
            hint="Page and card entrances, hover and press feedback, dialogs and charts."
          />
          <Field label="Animation level" htmlFor="animation_level" hint={LEVELS.find((option) => option.value === values.animation_level)?.note} className="sm:max-w-xs">
            <NativeSelect
              id="animation_level"
              value={values.animation_level}
              disabled={!values.animations_enabled}
              onChange={(event) => set("animation_level", event.target.value as MotionLevel)}
            >
              {LEVELS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Toggle
            checked={values.scroll_reveal_enabled}
            onChange={(checked) => set("scroll_reveal_enabled", checked)}
            disabled={level === "off"}
            label="Scroll reveal animation"
            hint="Content further down a page fades in, once, when it is scrolled into view."
          />
        </div>
      </FormSection>

      <FormSection title="Motion preview">
        {/* data-motion here re-derives the motion tokens for this box only. */}
        <div key={`${level}-${run}`} data-motion={level} className="motion-preview rounded-xl border bg-background p-4">
          <div data-reveal-list="" className="grid grid-cols-3 gap-2">
            {["Members", "Visitors", "Groups"].map((label, index) => (
              <div key={label} className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold tabular-nums">{[128, 14, 9][index]}</p>
              </div>
            ))}
          </div>
          <div data-reveal="" className="mt-2 rounded-lg border bg-card p-3" style={{ ["--reveal-delay" as string]: "calc(var(--motion-stagger) * 3)" }}>
            <p className="text-sm font-medium">Upcoming events</p>
            <p className="text-xs text-muted-foreground">Sunday Worship · 10:00 AM</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {level === "off" ? "Animations are off: content appears at once." : reveal ? "Entrances and scroll reveal are on." : "Entrances are on; scroll reveal is off."}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => setRun((count) => count + 1)} disabled={level === "off"}>
            <Play /> Replay
          </Button>
        </div>
      </FormSection>
    </div>
  );
}
