import { useEffect, useMemo, useRef, useState } from 'react';
import configEpicJson from './data/config-epic.json';
import holidaysJson from './data/holidays.json';
import plannerConfigJson from './data/planner-config.json';
import {
  acceptRatioDraft,
  addLeaveEntry,
  applyLeavePatch,
  clampSpRatio,
  computeZoneCapacity,
  countWeekdaysInWindow,
  finalizeRatioDraft,
  flattenHolidays,
  formatHolidayDate,
  formatSpRate,
  formatSprintDateRange,
  holidaysInWindow,
  initialConfigEpic,
  ratioFromDraft,
  removeLeaveEntry,
  roleSpRates,
  teamSize,
} from './engine';
import type {
  CapacityResult,
  ConfigEpic,
  DateRange,
  HolidaysByZone,
  LeaveEntry,
  PlannerConfig,
  PlanningSprint,
  UtilisationTier,
  WorkSp,
} from './types';

const plannerConfig = plannerConfigJson as PlannerConfig;
const holidaysByZone = holidaysJson as HolidaysByZone;
const holidays = flattenHolidays(holidaysByZone);

function RatioInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: number;
  onChange: (ratio: number) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(() => String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(String(value));
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className="control-ratio-input"
      aria-label={ariaLabel}
      title={ariaLabel}
      placeholder="1.4"
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => {
        const nextDraft = acceptRatioDraft(e.target.value);
        if (nextDraft === null) return;
        setDraft(nextDraft);
        const parsed = ratioFromDraft(nextDraft);
        if (parsed !== undefined) onChange(parsed);
      }}
      onBlur={() => {
        focusedRef.current = false;
        const committed = finalizeRatioDraft(draft, value);
        onChange(committed);
        setDraft(String(committed));
      }}
    />
  );
}

function ContextChip({
  label,
  value,
  hint,
  breakdown,
  pair,
}: {
  label: string;
  value: string | number;
  hint?: string;
  breakdown?: { dev: number; qa: number };
  pair?: { label: string; value: string | number };
}) {
  return (
    <div
      className={`capacity-chip${breakdown ? ' capacity-chip-breakdown' : ''}${pair ? ' capacity-chip-pair' : ''}`}
      title={hint}
    >
      <div className="capacity-chip-metric">
        <span className="capacity-chip-value">{value}</span>
        <span className="capacity-chip-label">{label}</span>
      </div>
      {pair ? (
        <div className="capacity-chip-metric">
          <span className="capacity-chip-value">{pair.value}</span>
          <span className="capacity-chip-label">{pair.label}</span>
        </div>
      ) : null}
      {breakdown ? (
        <ul className="capacity-chip-split" aria-label={`${label} by role`}>
          <li>
            <span>Dev</span>
            <strong>{breakdown.dev}</strong>
          </li>
          <li>
            <span>QA</span>
            <strong>{breakdown.qa}</strong>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

function LedgerRow({
  op,
  detail,
  result,
  resultSuffix,
  emphasis,
  tier,
}: {
  op: string;
  detail: string;
  result: string | number;
  resultSuffix?: string;
  emphasis?: boolean;
  tier?: UtilisationTier;
}) {
  return (
    <div
      className={`capacity-ledger-row${emphasis ? ' capacity-ledger-row-result' : ''}${tier ? ` util-${tier}` : ''}`}
    >
      <span className="capacity-ledger-op">{op}</span>
      <span className="capacity-ledger-detail">{detail}</span>
      <span className="capacity-ledger-result">
        {result}
        {resultSuffix ? <span className="capacity-ledger-suffix">{resultSuffix}</span> : null}
      </span>
    </div>
  );
}

function roleCapacityDetail(
  role: 'Dev' | 'QA',
  members: number,
  workingDays: number,
  leaveDays: number,
  ratio: number,
): string {
  const rate = formatSpRate(ratio);
  if (leaveDays > 0) {
    return `${role} ((${members} × ${workingDays} − ${leaveDays}) × ${rate})`;
  }
  return `${role} (${members} × ${workingDays} × ${rate})`;
}

function balanceTone(
  capacitySp: number,
  workSp: number,
): { tier: UtilisationTier; delta: number; usedPct: number } {
  const delta = capacitySp - workSp;
  const usedPct = capacitySp > 0 ? Math.round((workSp / capacitySp) * 100) : workSp > 0 ? 100 : 0;
  if (delta < 0) return { tier: 'overload', delta, usedPct };
  if (usedPct > 85) return { tier: 'tight', delta, usedPct };
  return { tier: 'headroom', delta, usedPct };
}

function clipSprintToWindow(sprint: PlanningSprint, window: DateRange): DateRange | null {
  const start = sprint.start < window.start ? window.start : sprint.start;
  const end = sprint.end > window.end ? window.end : sprint.end;
  if (end < start) return null;
  return { start, end };
}

function CapacitySummary({
  capacity,
  config,
  work,
  window,
  workingDays,
  holidayCount,
}: {
  capacity: CapacityResult;
  config: ConfigEpic;
  work: WorkSp;
  window: DateRange;
  workingDays: number[];
  holidayCount: number;
}) {
  const commitPct = Math.round(config.capacityCommitPercent * 100);
  const workSp = work.dev + work.qa;
  const rates = roleSpRates(config);
  const balance = balanceTone(capacity.availableSp, workSp);
  const overloadSp = Math.max(0, -balance.delta);
  const headroomSp = Math.max(0, balance.delta);
  const sprintRows = config.sprints
    .map((sprint) => {
      const range = clipSprintToWindow(sprint, window);
      if (!range) return null;
      const num = sprint.key.match(/(\d+)/)?.[1] ?? sprint.name.match(/(\d+)/)?.[1] ?? '?';
      return {
        key: sprint.key,
        label: `Sprint ${num}`,
        dates: formatSprintDateRange(range.start, range.end),
        weekdays: countWeekdaysInWindow(range, workingDays),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const sprintTotal = sprintRows.reduce((sum, row) => sum + row.weekdays, 0);

  return (
    <div className="capacity-panel">
      <div className="capacity-panel-top">
        <div className={`capacity-hero-strip util-${balance.tier}`} aria-label="Capacity vs work">
          <div
            className="capacity-hero-stat"
            title={`Available SP after commit % (team × working days − leaves). Dev ${capacity.availableSpDev} · QA ${capacity.availableSpQa}`}
          >
            <span className="capacity-hero-label">Capacity</span>
            <span className="capacity-hero-value">{capacity.availableSp}</span>
            <span className="capacity-hero-meta">SP to commit</span>
            <ul className="capacity-hero-breakdown" aria-label="SP to commit by role">
              <li>
                <span className="capacity-hero-breakdown-role">Dev</span>
                <span className="capacity-hero-breakdown-value">{capacity.availableSpDev}</span>
              </li>
              <li>
                <span className="capacity-hero-breakdown-role">QA</span>
                <span className="capacity-hero-breakdown-value">{capacity.availableSpQa}</span>
              </li>
            </ul>
          </div>
          <div className="capacity-hero-divider" aria-hidden="true" />
          <div
            className="capacity-hero-stat"
            title={`Work SP entered in planning controls. Dev ${work.dev} · QA ${work.qa}`}
          >
            <span className="capacity-hero-label">Work</span>
            <span className="capacity-hero-value">{workSp}</span>
            <span className="capacity-hero-meta">SP on board</span>
            <ul className="capacity-hero-breakdown" aria-label="Work SP by role">
              <li>
                <span className="capacity-hero-breakdown-role">Dev</span>
                <span className="capacity-hero-breakdown-value">{work.dev}</span>
              </li>
              <li>
                <span className="capacity-hero-breakdown-role">QA</span>
                <span className="capacity-hero-breakdown-value">{work.qa}</span>
              </li>
            </ul>
          </div>
          <div className="capacity-hero-divider" aria-hidden="true" />
          <div
            className="capacity-hero-stat capacity-hero-stat-balance"
            title={
              overloadSp > 0
                ? `Work exceeds capacity by ${overloadSp} SP`
                : headroomSp > 0
                  ? `${headroomSp} SP capacity remaining`
                  : 'Work matches capacity'
            }
          >
            <span className="capacity-hero-label">Balance</span>
            <span className="capacity-hero-value">{overloadSp > 0 ? `+${overloadSp}` : headroomSp}</span>
            <span className="capacity-hero-meta">
              {overloadSp > 0
                ? `SP over · ${balance.usedPct}%`
                : headroomSp > 0
                  ? `SP free · ${balance.usedPct}%`
                  : `On target · ${balance.usedPct}%`}
            </span>
          </div>
        </div>

        <div className="capacity-chips" aria-label="Capacity inputs">
          <ContextChip
            label="Weekdays"
            value={capacity.totalManDays}
            hint={`Mon–Fri in window · ${holidayCount} TH holiday(s)`}
            pair={{ label: 'Holidays', value: capacity.holidayDaysInWindow }}
          />
          <ContextChip
            label="Team"
            value={capacity.devMembers + capacity.qaMembers}
            hint={`Dev ${capacity.devMembers} · QA ${capacity.qaMembers}`}
            breakdown={{ dev: capacity.devMembers, qa: capacity.qaMembers }}
          />
          <ContextChip
            label="Leaves"
            value={capacity.leaveDays}
            hint={`Dev ${capacity.leaveDaysDev} · QA ${capacity.leaveDaysQa}`}
            breakdown={{ dev: capacity.leaveDaysDev, qa: capacity.leaveDaysQa }}
          />
          <ContextChip label="Commit" value={`${commitPct}%`} />
        </div>
      </div>

      <div className="capacity-panel-body">
        <div className="capacity-sprint-block">
          <div className="capacity-sprint-header">
            <span className="capacity-sprint-title">Sprint weekdays</span>
            <span className="capacity-sprint-total">{capacity.totalManDays} total</span>
          </div>
          {sprintRows.length > 0 ? (
            <table className="sprint-mandays-table">
              <thead>
                <tr>
                  <th>Sprint</th>
                  <th>Dates</th>
                  <th>Weekdays</th>
                </tr>
              </thead>
              <tbody>
                {sprintRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{row.dates}</td>
                    <td>{row.weekdays}</td>
                  </tr>
                ))}
                <tr className="sprint-mandays-total">
                  <td colSpan={2}>Total</td>
                  <td>{sprintTotal}</td>
                </tr>
              </tbody>
            </table>
          ) : null}
        </div>

        <div className="capacity-ledger" aria-label="Capacity calculation">
          <div className="capacity-ledger-header">
            <span>Step</span>
            <span>Detail</span>
            <span>Result</span>
          </div>
          <LedgerRow
            op="="
            detail={
              capacity.holidayDaysInWindow > 0
                ? `Working days (${capacity.totalManDays} − ${capacity.holidayDaysInWindow} holidays)`
                : 'Working days'
            }
            result={capacity.workingDays}
          />
          <LedgerRow
            op="+"
            detail={roleCapacityDetail(
              'Dev',
              capacity.devMembers,
              capacity.workingDays,
              capacity.leaveDaysDev,
              rates.dev,
            )}
            result={capacity.roleCapacityDev}
          />
          <LedgerRow
            op="+"
            detail={roleCapacityDetail(
              'QA',
              capacity.qaMembers,
              capacity.workingDays,
              capacity.leaveDaysQa,
              rates.qa,
            )}
            result={capacity.roleCapacityQa}
          />
          <LedgerRow op="=" detail="Total capacity" result={capacity.totalCapacity} />
          <LedgerRow
            op="×"
            detail={`Team commitment (${commitPct}%)`}
            result={capacity.availableSp}
            resultSuffix="SP"
            emphasis
            tier={balance.tier}
          />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState<ConfigEpic>(() =>
    initialConfigEpic(configEpicJson as Omit<ConfigEpic, 'devSpPerManDay' | 'qaSpPerManDay'>),
  );
  const [work, setWork] = useState<WorkSp>({ dev: 0, qa: 0 });

  const windowInvalid = config.window.end < config.window.start;
  const workingDays = plannerConfig['working-days'];
  const thHolidays = holidaysInWindow(
    holidays.filter((holiday) => holiday.zone === 'TH'),
    config.window,
  );

  const capacity = useMemo(
    () => (windowInvalid ? null : computeZoneCapacity(config.window, config, holidays, plannerConfig)),
    [config, windowInvalid],
  );

  const setWindow = (window: DateRange) => {
    setConfig((current) => ({ ...current, window }));
  };

  const setZoneMembers = (zone: 'Dev' | 'QA', members: number) => {
    const count = Math.max(0, members);
    setConfig((current) => ({
      ...current,
      zones: { ...current.zones, [zone]: { ...current.zones[zone], members: count } },
    }));
  };

  const setRoleSpRatio = (role: 'Dev' | 'QA', ratio: number) => {
    setConfig((current) => ({
      ...current,
      zones: { ...current.zones, [role]: { ...current.zones[role], ratio: clampSpRatio(ratio) } },
      ...(role === 'Dev' ? { devSpPerManDay: clampSpRatio(ratio) } : { qaSpPerManDay: clampSpRatio(ratio) }),
    }));
  };

  const setCapacityCommitPercent = (percent: number) => {
    const value = Math.min(100, Math.max(0, percent)) / 100;
    setConfig((current) => ({ ...current, capacityCommitPercent: value }));
  };

  const updateLeave = (index: number, patch: Partial<LeaveEntry>) => {
    setConfig((current) => ({
      ...current,
      leaves: applyLeavePatch(current.leaves, index, patch, workingDays),
    }));
  };

  return (
    <div className="capacity-planner">
      <div className="planner-container">
        <header className="planner-header">
          <h1>Capacity Planner</h1>
        </header>

        <section className="planner-section planner-section-compact planner-controls-section">
          <h2 className="section-title section-title-compact">Planning controls</h2>

          <div className="controls-bar controls-bar-compact">
            <div className="control-window-pair">
              <label className="control-field">
                <span>Window start</span>
                <input
                  type="date"
                  value={config.window.start}
                  max={config.window.end}
                  onChange={(e) => setWindow({ ...config.window, start: e.target.value })}
                />
              </label>
              <label className="control-field">
                <span>Window end</span>
                <input
                  type="date"
                  value={config.window.end}
                  min={config.window.start}
                  onChange={(e) => setWindow({ ...config.window, end: e.target.value })}
                />
              </label>
            </div>
            <div className="control-role-pair">
              <label className="control-field">
                <span>Dev team</span>
                <input
                  type="number"
                  min={0}
                  max={99}
                  step={0.1}
                  value={config.zones.Dev.members}
                  onChange={(e) => setZoneMembers('Dev', Number(e.target.value))}
                  title="Dev headcount"
                />
              </label>
              <label className="control-field">
                <span>Dev ratio</span>
                <RatioInput
                  value={config.zones.Dev.ratio}
                  onChange={(ratio) => setRoleSpRatio('Dev', ratio)}
                  ariaLabel="Dev ratio"
                />
              </label>
            </div>
            <div className="control-role-pair">
              <label className="control-field">
                <span>QA team</span>
                <input
                  type="number"
                  min={0}
                  max={99}
                  step={0.1}
                  value={config.zones.QA.members}
                  onChange={(e) => setZoneMembers('QA', Number(e.target.value))}
                  title="QA headcount"
                />
              </label>
              <label className="control-field">
                <span>QA ratio</span>
                <RatioInput
                  value={config.zones.QA.ratio}
                  onChange={(ratio) => setRoleSpRatio('QA', ratio)}
                  ariaLabel="QA ratio"
                />
              </label>
            </div>
            <div className="control-role-pair">
              <div className="control-field control-field-compact">
                <span>Team</span>
                <div className="control-chips control-chips-compact">
                  <span className="control-chip" title="Team = Dev + QA">
                    {teamSize(config.zones)}
                  </span>
                </div>
              </div>
              <label className="control-field">
                <span>Commit %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(config.capacityCommitPercent * 100)}
                  onChange={(e) => setCapacityCommitPercent(Number(e.target.value))}
                />
              </label>
            </div>
            <div className="control-role-pair">
              <label className="control-field">
                <span>Work Dev</span>
                <input
                  type="number"
                  min={0}
                  value={work.dev}
                  onChange={(e) => setWork((current) => ({ ...current, dev: Number(e.target.value) || 0 }))}
                  title="Dev story points on the board"
                />
              </label>
              <label className="control-field">
                <span>Work QA</span>
                <input
                  type="number"
                  min={0}
                  value={work.qa}
                  onChange={(e) => setWork((current) => ({ ...current, qa: Number(e.target.value) || 0 }))}
                  title="QA story points on the board"
                />
              </label>
            </div>
          </div>

          <div className="controls-expand-stack">
            <div className="controls-expand-row controls-expand-row-holidays">
              <details className="compact-expand-block zone-holidays-details">
                <summary>TH holidays ({thHolidays.length})</summary>
                {thHolidays.length === 0 ? (
                  <p className="zone-holidays-empty">No TH holidays in this planning window.</p>
                ) : (
                  <div className="zone-holidays-table-wrap">
                    <table className="zone-holidays-table">
                      <thead>
                        <tr>
                          <th scope="col">Date</th>
                          <th scope="col">Holiday</th>
                        </tr>
                      </thead>
                      <tbody>
                        {thHolidays.map((holiday) => (
                          <tr key={`${holiday.date}-${holiday.name}`}>
                            <td>{formatHolidayDate(holiday.date)}</td>
                            <td>{holiday.name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            </div>
            <div className="controls-expand-row controls-expand-row-leaves">
              <details className="compact-expand-block leaves-details">
                <summary>Planned leaves ({config.leaves.length})</summary>
                <div className="leaves-panel leaves-panel-compact">
                  <div className="leaves-panel-header">
                    <button
                      type="button"
                      className="btn-secondary btn-small"
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          leaves: addLeaveEntry(current.leaves, current.window.start),
                        }))
                      }
                    >
                      Add leave
                    </button>
                  </div>
                  <div className="leaves-table-wrap">
                    <table className="leaves-table">
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Start date</th>
                          <th>End date</th>
                          <th>Role</th>
                          <th>Days</th>
                          <th aria-label="Remove" />
                        </tr>
                      </thead>
                      <tbody>
                        {config.leaves.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="leaves-empty">
                              No planned leaves.
                            </td>
                          </tr>
                        ) : (
                          config.leaves.map((leave, index) => {
                            const start = leave.start ?? leave.date ?? '';
                            const end = leave.end ?? leave.date ?? leave.start ?? '';
                            return (
                              <tr key={`leave-row-${index}`}>
                                <td>
                                  <input
                                    type="text"
                                    value={leave.member}
                                    onChange={(e) => updateLeave(index, { member: e.target.value })}
                                    placeholder="Name"
                                    aria-label={`Leave member ${index + 1}`}
                                    autoComplete="off"
                                  />
                                </td>
                                <td className="leave-date-cell">
                                  <input
                                    type="date"
                                    value={start}
                                    max={end || undefined}
                                    onChange={(e) =>
                                      updateLeave(index, {
                                        start: e.target.value,
                                        end: end || e.target.value,
                                      })
                                    }
                                    aria-label={`Leave start date for ${leave.member || 'member'}`}
                                  />
                                </td>
                                <td className="leave-date-cell">
                                  <input
                                    type="date"
                                    value={end}
                                    min={start || undefined}
                                    onChange={(e) =>
                                      updateLeave(index, {
                                        start: start || e.target.value,
                                        end: e.target.value,
                                      })
                                    }
                                    aria-label={`Leave end date for ${leave.member || 'member'}`}
                                  />
                                </td>
                                <td>
                                  <select
                                    value={leave.zone}
                                    onChange={(e) =>
                                      updateLeave(index, { zone: e.target.value as LeaveEntry['zone'] })
                                    }
                                  >
                                    <option value="Dev">Dev</option>
                                    <option value="QA">QA</option>
                                  </select>
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min={0}
                                    max={99}
                                    value={leave.days}
                                    readOnly
                                    title="Working days between start and end"
                                    aria-label={`Leave days for ${leave.member || 'member'}`}
                                  />
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="btn-secondary btn-small"
                                    onClick={() =>
                                      setConfig((current) => ({
                                        ...current,
                                        leaves: removeLeaveEntry(current.leaves, index),
                                      }))
                                    }
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            </div>
          </div>

          {windowInvalid && (
            <p className="planner-error" role="alert">
              End date must be on or after start date.
            </p>
          )}

          {capacity && (
            <CapacitySummary
              capacity={capacity}
              config={config}
              work={work}
              window={config.window}
              workingDays={workingDays}
              holidayCount={thHolidays.length}
            />
          )}
        </section>
      </div>
    </div>
  );
}
