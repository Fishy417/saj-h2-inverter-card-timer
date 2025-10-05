/**
 * SAJ H2 Inverter Card Timer
 * Custom card for Home Assistant to control SAJ H2 Inverter charging and discharging settings
 * - Uses Shadow DOM for encapsulation.
 * - Supports configuration entity overrides.
 * - Handles pending states via hass object updates.
 * - Protects specific input interactions (time, range) from disruptive re-renders.
 * - Timer-based enable functionality for quick setup
 * based on saj-h2-inverter-card by @stanu74
 * @author fishy417 
 * @version 1.0.6
 */

class SajH2InverterCardTimer extends HTMLElement {
  static VERSION = '1.0.6';
  
  static get DEFAULT_ENTITIES() {
    // Default entity IDs (can be overridden in Lovelace config)
    return {
      // Charging entities
      chargeStart: 'text.saj_charge_start_time_time',
      chargeEnd:   'text.saj_charge_end_time_time',
      chargeDayMask: 'number.saj_charge_day_mask_input',
      chargePower: 'number.saj_battery_charge_power_limit_input',
      chargingSwitch: 'switch.saj_charging_control',
      chargePowerSensor: 'sensor.saj_charge_power_percent',
      batteryChargePowerLimit: 'sensor.saj_battery_charge_power_limit',

      // Discharging entities (single slot only)
      dischargeStart: 'text.saj_discharge1_start_time_time',
      dischargeEnd: 'text.saj_discharge1_end_time_time', 
      dischargePower: 'number.saj_discharge1_power_percent_input',
      dischargeDayMask: 'number.saj_discharge1_day_mask_input',
      dischargingSwitch:'switch.saj_discharging_control',
      dischargePowerSensor: 'sensor.saj_discharge_power_percent'
    };
  }

  constructor() {
    super();

    console.log(`[SAJ H2 Inverter Card Timer] Version: ${SajH2InverterCardTimer.VERSION}`);
  
    // Inverter maximum output in kW (will be set by config, default used if not specified)
    this._inverterMaxOutput = 5.0; // Default value, can be overridden in Lovelace config
    
    this.attachShadow({ mode: 'open' }); // Attach Shadow DOM

    
    // Initialize properties
    this._entities = JSON.parse(JSON.stringify(SajH2InverterCardTimer.DEFAULT_ENTITIES));
    this._mode = 'both';
    this._hass = null;
    this._debug = false;
    this._lastForceUpdate = 0;
    this._lastDebugLog = 0;
    this._lastTimerCheck = 0;
  }

  // Helper functions for percentage/kW conversion
  _percentToKw(percent) {
    return ((percent / 100) * this._inverterMaxOutput).toFixed(1);
  }

  _kwToPercent(kw) {
    return Math.round((kw / this._inverterMaxOutput) * 100);
  }

  // Convert percentage to kW for slider display (0.5kW increments)
  _percentToSliderKw(percent) {
    return Math.round(((percent / 100) * this._inverterMaxOutput) * 2) / 2;
  }

  // Convert slider kW value back to percentage
  _sliderKwToPercent(kw) {
    return Math.round((kw / this._inverterMaxOutput) * 100);
  }

  // Called by Lovelace when configuration is set
  setConfig(config) {
    if (!config) {
      throw new Error('Invalid configuration');
    }

    this._mode = config.mode || 'both';
    if (!['charge','discharge','both'].includes(this._mode)) {
      throw new Error(`Invalid mode: ${this._mode}. Must be one of: charge, discharge, both`);
    }

    // Set inverter max output from config or use default
    this._inverterMaxOutput = config.maxOutput || 5.0;
    if (typeof this._inverterMaxOutput !== 'number' || this._inverterMaxOutput <= 0) {
      throw new Error(`Invalid maxOutput: ${this._inverterMaxOutput}. Must be a positive number representing kW capacity.`);
    }

    // Deep merge user-provided entities with defaults
    this._entities = this._deepMerge(
        JSON.parse(JSON.stringify(SajH2InverterCardTimer.DEFAULT_ENTITIES)),
        config.entities || {}
    );

    this._debug = config.debug === true;

    // Trigger initial render if hass is already available
    if (this.shadowRoot && this._hass) {
      this._renderCard();
    }
  }

  // Called by Home Assistant when the state changes
  set hass(hass) {
    if (!hass) return;

    const shouldUpdate = this._shouldUpdate(hass);
    // Check interaction status *before* potential re-render
    const userInteracting = this._isUserInteracting();

    // Update internal state AFTER calculations based on the previous state
    this._hass = hass;

    // Debug: Log sensor entity values every 10 seconds
    const now = Date.now();
    if (!this._lastDebugLog || (now - this._lastDebugLog) > 10000) {
        this._lastDebugLog = now;
        const chargePowerEntity = hass.states[this._entities.chargePowerSensor];
        const dischargePowerEntity = hass.states[this._entities.dischargePowerSensor];
        console.log(`[saj-card] Debug - Charge power: ${chargePowerEntity?.state}, Discharge power: ${dischargePowerEntity?.state}`);
    }

    // Check for timer expiration every 60 seconds
    if (!this._lastTimerCheck || (now - this._lastTimerCheck) > 60000) {
        this._lastTimerCheck = now;
        this._checkTimerExpiration();
    }

    // Force update every 30 seconds for sensor entities (failsafe)
    if (!this._lastForceUpdate || (now - this._lastForceUpdate) > 30000) {
        this._lastForceUpdate = now;
        console.log(`[saj-card] Force update after 30s`);
        if (this.shadowRoot && !userInteracting) {
            this._renderCard();
        }
        return;
    }

    // Render logic: Render if shadowRoot exists AND (update needed OR initial render)
    // AND user is NOT interacting with protected elements (time, range)
    if (this.shadowRoot && (shouldUpdate || !this.shadowRoot.innerHTML) && !userInteracting) {
        console.log(`[saj-card] Rendering card due to state change`);
        this._renderCard();
    } else if (shouldUpdate && userInteracting) {
        console.log(`[saj-card] Skipping render due to user interaction`);
    }
  }

  // Check if the user is actively interacting with specific input types
  _isUserInteracting() {
    if (!this.shadowRoot) return false;
    const activeElement = this.shadowRoot.activeElement;
    if (!activeElement) return false;

    // Protect time and range inputs from re-renders while focused
    if (activeElement.tagName === 'INPUT') {
      const type = activeElement.type.toLowerCase();
      if (type === 'time' || type === 'range') {
        // console.log("[saj-card] Interaction detected:", activeElement.tagName, activeElement.type); // Debugging
        return true; // Currently interacting with time or range input
      }
    }
    // Allow rendering for other interactions (buttons, checkboxes, focus elsewhere)
    return false;
  }

  // Determine if a re-render is needed based on relevant entity state changes
  _shouldUpdate(newHass) {
    if (!this._hass) return true; // Always update if old state doesn't exist

    // --- Gather all relevant entity IDs based on current config ---
    const relevantEntityIds = [];
    if (this._mode !== 'discharge') {
        relevantEntityIds.push(
            this._entities.chargeStart, this._entities.chargeEnd,
            this._entities.chargeDayMask, this._entities.chargePower,
            this._entities.chargingSwitch, // Crucial switch
            this._entities.chargePowerSensor, // Power sensor for readonly display
            this._entities.batteryChargePowerLimit // Battery charge power limit for current power
        );
    }
    if (this._mode !== 'charge') {
        relevantEntityIds.push(
            this._entities.dischargeStart, this._entities.dischargeEnd,
            this._entities.dischargeDayMask, this._entities.dischargePower,
            this._entities.dischargingSwitch, // Crucial switch
            this._entities.dischargePowerSensor // Power sensor for readonly display
        );
    }
    // Remove duplicates and filter out any null/undefined values
    const uniqueIds = [...new Set(relevantEntityIds)].filter(Boolean);

    // --- Check for changes in any relevant entity ---
    for (const id of uniqueIds) {
        const oldState = this._hass.states[id];
        const newState = newHass.states[id];

        // Check if state object itself is different (covers new/removed entities)
        if (oldState !== newState) {
            // If entity just appeared/disappeared update is needed.
            if(!oldState || !newState) {
                console.log(`[saj-card] _shouldUpdate: entity ${id} appeared/disappeared`);
                return true;
            }
            
            // Check if the state value itself changed
            if (oldState.state !== newState.state) {
                console.log(`[saj-card] _shouldUpdate: state changed for ${id}: ${oldState.state} -> ${newState.state}`);
                return true;
            }
            
            // Specifically check if pending_write status changed
            if (oldState?.attributes?.pending_write !== newState?.attributes?.pending_write) {
                console.log(`[saj-card] _shouldUpdate: pending_write changed for ${id}: ${oldState?.attributes?.pending_write} -> ${newState?.attributes?.pending_write}`);
                return true;
            }
            
            // Check if last_changed or last_updated changed (indicates sensor update)
            if (oldState.last_changed !== newState.last_changed || oldState.last_updated !== newState.last_updated) {
                console.log(`[saj-card] _shouldUpdate: timestamp changed for ${id}`);
                return true;
            }
        }
    }

    // No relevant changes detected that require a re-render
    return false;
  }

  // Main render function, updates the Shadow DOM
  _renderCard() {
    if (!this._hass || !this.shadowRoot) return; // Guard clauses

    // Final check before manipulating DOM
    if (this._isUserInteracting()) {
         // console.log("[saj-card] Final interaction check prevented render."); // Debug
         return;
    }

    // --- Prepare Content ---
    let cardContent = '';
    let hasError = false;

    // Render Discharging Section FIRST
    if (this._mode !== 'charge') {
      const dischargeResult = this._renderDischargingSection();
       if (dischargeResult.error) hasError = true;
      cardContent += dischargeResult.html;
    }

    // Render Charging Section SECOND
    if (this._mode !== 'discharge') {
      const chargeResult = this._renderChargingSection();
      if (chargeResult.error) hasError = true;
      cardContent += chargeResult.html;
    }

    // Add general error if specific sections failed silently
     if (hasError && !cardContent.includes('card-error') && !cardContent.includes('ha-alert')) {
         cardContent = `<ha-alert alert-type="error">Required entities missing. Please check card configuration and ensure entities exist in Home Assistant.</ha-alert>` + cardContent;
     }

    // --- Render to Shadow DOM ---
    // Store current focus and selection range (if any) to restore it later
    const activeElement = this.shadowRoot.activeElement;
    const activeElementId = activeElement?.id;
    const selectionStart = activeElement?.selectionStart;
    const selectionEnd = activeElement?.selectionEnd;

    this.shadowRoot.innerHTML = `
      <style>
        ${this._getStyles()}
      </style>
      <ha-card>
        <div class="card-content">
          ${cardContent}
        </div>
      </ha-card>
    `;

    // Restore focus and selection if an element had focus before re-render
    if (activeElementId) {
        const elementToRestoreFocus = this.shadowRoot.getElementById(activeElementId);
        if (elementToRestoreFocus) {
            elementToRestoreFocus.focus();
            // Restore selection range for text/time inputs if applicable
            if (selectionStart !== undefined && selectionEnd !== undefined && typeof elementToRestoreFocus.setSelectionRange === 'function') {
                try {
                    elementToRestoreFocus.setSelectionRange(selectionStart, selectionEnd);
                } catch (e) {
                    // Ignore errors (e.g., element type doesn't support selection range)
                }
            }
        }
    }

    // Add event listeners after the DOM is updated
    // Use requestAnimationFrame to ensure DOM is fully painted before adding listeners/setting styles
    requestAnimationFrame(() => {
        this._addEventListeners();
        this._updateSliderStyles(); // Update slider track fills after render
    });
  }

  // Render the charging section HTML
  _renderChargingSection() {
    const s = this._entities;
    const es = this._hass.states;
    const start = es[s.chargeStart], end = es[s.chargeEnd], mask = es[s.chargeDayMask], power = es[s.chargePower], sw = es[s.chargingSwitch];
    const powerSensor = es[s.chargePowerSensor];
    const batteryChargePowerLimit = es[s.batteryChargePowerLimit];

    if (!start || !end || !mask || !power || !sw) {
      const missing = [
          !start && s.chargeStart, !end && s.chargeEnd, !mask && s.chargeDayMask,
          !power && s.chargePower, !sw && s.chargingSwitch
      ].filter(Boolean).join(', ');
      return { html: `<div class="card-error"><h2>Charging Entities Missing</h2><p>Check: ${missing || 'configuration'}</p></div>`, error: true };
    }

    const chargeStart = start.state;
    const chargeEnd = end.state;
    const chargeDayMask = parseInt(mask.state) || 0;
    // Convert 0.1% increments to percentage for display (divide by 10)
    const chargePower = Math.round((parseInt(power.state) || 0) / 10);
    const chargingEnabled = sw.state === 'on';
    // Read pending_write status directly from the hass object
    const pendingWrite = sw.attributes?.pending_write === true;
    // Get actual power from battery charge power limit sensor (fallback to charge power if not available)
    const actualChargePower = batteryChargePowerLimit ? (parseInt(batteryChargePowerLimit.state) || 0) : chargePower;
    
    // Convert percentage to kW for slider display
    const chargePowerKw = this._percentToSliderKw(chargePower);
    const actualChargePowerKw = this._percentToKw(actualChargePower);
    const minKw = this._percentToSliderKw(10);
    const maxKw = this._percentToSliderKw(100);

    const html = `
      <div class="section charging-section">
        <h3 class="section-heading">Charge Controls</h3>
        <div class="controls-container">
          <div class="power-control">
            <div class="slider-container">
              <input type="range" id="charge-power-slider" class="power-slider" min="${minKw}" max="${maxKw}" step="0.5" value="${chargePowerKw}" ${pendingWrite ? 'disabled' : ''} title="Controls PV charge limits when charging disabled, PV+Grid when enabled" />
              <span id="charge-power-value" class="power-value">${chargePowerKw}&nbsp;kW</span>
            </div>
          </div>
          
          <div class="timer-control">
            <label class="control-label">Duration (mins):</label>
            <input type="number" id="charge-timer" class="timer-input" min="1" max="1440" step="1" value="${this._getTimerValue('charge', 30)}" />
            <button id="charging-enable" class="control-button enable-btn" ${pendingWrite ? 'disabled' : ''}>${chargingEnabled ? 'Extend' : 'Enable'}</button>
            <button id="charging-disable" class="control-button disable-btn" ${pendingWrite || !chargingEnabled ? 'disabled' : ''}>Disable</button>
          </div>
        </div>
        
        <div class="readonly-container">
          <div class="status-line">
            ${pendingWrite ? 
              '<span class="status-text status-pending">Wait for Modbus Transfer</span>' : 
              `<span class="status-text ${chargingEnabled ? 'status-active' : 'status-inactive'}">${chargingEnabled ? 'Active' : 'Inactive'}</span>`
            }
          </div>
          <div class="data-line">
            <div class="readonly-field">
              <span class="readonly-value">${actualChargePowerKw} kW</span>
              <label class="readonly-label">Current Power</label>
            </div>
            ${this._renderTimeSelects('charge', chargeStart, chargeEnd, chargePower, pendingWrite)}
          </div>
        </div>
      </div>`;
      return { html: html, error: false };
  }

  // Render the discharging section HTML
  _renderDischargingSection() {
    const es = this._hass.states;
    const start = es[this._entities.dischargeStart];
    const end = es[this._entities.dischargeEnd]; 
    const mask = es[this._entities.dischargeDayMask];
    const power = es[this._entities.dischargePower];
    const sw = es[this._entities.dischargingSwitch];
    const powerSensor = es[this._entities.dischargePowerSensor];

    if (!start || !end || !mask || !power || !sw) {
      const missing = [
          !start && this._entities.dischargeStart, 
          !end && this._entities.dischargeEnd, 
          !mask && this._entities.dischargeDayMask,
          !power && this._entities.dischargePower, 
          !sw && this._entities.dischargingSwitch
      ].filter(Boolean).join(', ');
      return { html: `<div class="card-error"><h2>Discharging Entities Missing</h2><p>Check: ${missing || 'configuration'}</p></div>`, error: true };
    }

    const dischargeStart = start.state;
    const dischargeEnd = end.state;
    const dischargeDayMask = parseInt(mask.state) || 0;
    const dischargePower = parseInt(power.state) || 0;
    const dischargingEnabled = sw.state === 'on';
    const pendingWrite = sw.attributes?.pending_write === true;
    // Get actual power from sensor (fallback to input if sensor not available)
    const actualDischargePower = powerSensor ? (parseInt(powerSensor.state) || 0) : dischargePower;
    
    // Convert percentage to kW for slider display
    const dischargePowerKw = this._percentToSliderKw(dischargePower);
    const actualDischargePowerKw = this._percentToKw(actualDischargePower);
    const minKw = this._percentToSliderKw(10);
    const maxKw = this._percentToSliderKw(100);

    const html = `
      <div class="section discharging-section">
        <h3 class="section-heading">Discharge Control v${SajH2InverterCardTimer.VERSION}</h3>
        <div class="controls-container">
          <div class="power-control">
            <div class="slider-container">
              <input type="range" id="discharge-power-slider" class="power-slider" min="${minKw}" max="${maxKw}" step="0.5" value="${dischargePowerKw}" ${pendingWrite ? 'disabled' : ''} />
              <span id="discharge-power-value" class="power-value">${dischargePowerKw}&nbsp;kW</span>
            </div>
          </div>
          
          <div class="timer-control">
            <label class="control-label">Duration (mins):</label>
            <input type="number" id="discharge-timer" class="timer-input" min="1" max="1440" step="1" value="${this._getTimerValue('discharge', 30)}" />
            <button id="discharging-enable" class="control-button enable-btn" ${pendingWrite ? 'disabled' : ''}>${dischargingEnabled ? 'Extend' : 'Enable'}</button>
            <button id="discharging-disable" class="control-button disable-btn" ${pendingWrite || !dischargingEnabled ? 'disabled' : ''}>Disable</button>
          </div>
        </div>
        
        <div class="readonly-container">
          <div class="status-line">
            ${pendingWrite ? 
              '<span class="status-text status-pending">Wait for Modbus Transfer</span>' : 
              `<span class="status-text ${dischargingEnabled ? 'status-active' : 'status-inactive'}">${dischargingEnabled ? 'Active' : 'Inactive'}</span>`
            }
          </div>
          <div class="data-line">
            <div class="readonly-field">
              <span class="readonly-value">${actualDischargePowerKw} kW</span>
              <label class="readonly-label">Current Power</label>
            </div>
            ${this._renderTimeSelects('discharge', dischargeStart, dischargeEnd, dischargePower, pendingWrite)}
          </div>
        </div>
      </div>`;
      return { html: html, error: false };
  }



  // Render the time input elements - showing end time in plain readonly style
  _renderTimeSelects(prefix, startTime, endTime, power = null, disabled = false) {
     // Ensure times are valid HH:MM format or default
     const validEndTime = /^([01]\d|2[0-3]):([0-5]\d)$/.test(endTime) ? endTime : '00:00';
     
     // Convert to 12-hour format for display
     const [hours, minutes] = validEndTime.split(':').map(Number);
     const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
     const ampm = hours >= 12 ? 'PM' : 'AM';
     const displayTime = `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;

     return `
      <div class="readonly-field clickable-time-field" data-time-input="${prefix}-end-time">
        <span class="readonly-value">${displayTime}</span>
        <label class="readonly-label">End Time</label>
        <input type="time" id="${prefix}-end-time" value="${validEndTime}" step="300" class="time-input-hidden" ${disabled ? 'disabled' : ''} />
      </div>`;
  }



  // Render day selection checkboxes
  _renderDayCheckboxes(prefix, mask, disabled = false) {
    const days = this._getDaysFromMask(mask);
    return ['Mo','Tu','We','Th','Fr','Sa','Su'].map((dayAbbr, i) => `
      <label class="day-checkbox ${disabled ? 'disabled' : ''}">
        <input type="checkbox" id="${prefix}-day-${dayAbbr.toLowerCase()}" data-day-index="${i}" ${days[['monday','tuesday','wednesday','thursday','friday','saturday','sunday'][i]] ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
        <span>${dayAbbr}</span>
      </label>`).join('');
  }

  // Render the main status button (Charge/Discharge enable/disable)
  // This version relies *only* on isPending from the hass state.
  _renderStatusButton(isEnabled, isPending, type) {
    const typeCapitalized = type.charAt(0).toUpperCase() + type.slice(1);
    // Button text indicates the action clicking will take
    const actionText = isEnabled ? `Disable ${typeCapitalized}` : `Enable ${typeCapitalized}`;
    // Button HTML: Disable it when pending.
    const button = `<button id="${type}-toggle" class="control-button ${isEnabled ? 'active' : ''}" ${isPending ? 'disabled' : ''}>${actionText}</button>`;

    // Status Display HTML: Show specific "Wait..." message ONLY when pending.
    let statusDisplayHtml;
    if (isPending) {
        statusDisplayHtml = `
            <div class="status-display">
                <div class="wait-message">Wait for Modbus Transfer</div>
            </div>`;
    } else {
        const statusText = isEnabled ? `${typeCapitalized} active` : `${typeCapitalized} inactive`;
        statusDisplayHtml = `
            <div class="status-display">
                Status: <span class="status-value ${isEnabled ? 'active' : 'inactive'}">${statusText}</span>
            </div>`;
    }
    // Combine button and status display
    return `${button}${statusDisplayHtml}`;
  }


  // Add all event listeners after rendering
  _addEventListeners() {
    if (!this.shadowRoot) return;
    if (this._mode !== 'discharge') this._addChargingEventListeners();
    if (this._mode !== 'charge') this._addDischargingEventListeners();
  }

  // Add listeners for the charging section
  // This version only calls the service, no optimistic UI updates.
  _addChargingEventListeners() {
    const q = sel => this.shadowRoot.querySelector(sel);
    const chargeSection = q('.charging-section');
    if (!chargeSection) return;

    // Charge Enable Button
    const enableBtn = q('#charging-enable');
    if (enableBtn && !enableBtn.hasAttribute('data-listener-added')) {
      enableBtn.setAttribute('data-listener-added', 'true');
      enableBtn.addEventListener('click', () => {
        const entityId = this._entities.chargingSwitch;
        const currentState = this._hass.states[entityId]?.state;
        const timerInput = q('#charge-timer');
        const chargePowerSlider = q('#charge-power-slider');
        const duration = timerInput ? parseInt(timerInput.value, 10) : 30;
        
        if (currentState === 'on') {
          // Extend functionality: Set end time to current time + duration
          const currentTime = this._getCurrentTime();
          const extendedEndTime = this._calculateEndTime(currentTime, duration);
          this._setEntityValue(this._entities.chargeEnd, extendedEndTime, 'text');
        } else {
          // Enable functionality: Set new timer-based schedule
          // Convert kW slider value to percentage for entity
          const chargePowerKw = chargePowerSlider ? parseFloat(chargePowerSlider.value) : 1.25;
          const chargePower = this._sliderKwToPercent(chargePowerKw);
          
          const startTime = this._getCurrentTime();
          const endTime = this._calculateEndTime(startTime, duration);
          const dayMask = this._getTodayDayMask();
          
          // Set the time schedule and power first
          this._setEntityValue(this._entities.chargeStart, startTime, 'text');
          this._setEntityValue(this._entities.chargeEnd, endTime, 'text');
          this._setEntityValue(this._entities.chargeDayMask, dayMask, 'number');
          this._setEntityValue(this._entities.chargePower, chargePower, 'number');
          
          // Small delay to ensure time settings are processed before enabling
          setTimeout(() => {
            this._hass.callService('switch', 'turn_on', { entity_id: entityId });
          }, 100);
        }
      });
    }

    // Charge Disable Button
    const disableBtn = q('#charging-disable');
    if (disableBtn && !disableBtn.hasAttribute('data-listener-added')) {
      disableBtn.setAttribute('data-listener-added', 'true');
      disableBtn.addEventListener('click', () => {
        const entityId = this._entities.chargingSwitch;
        this._hass.callService('switch', 'turn_off', { entity_id: entityId });
      });
    }

    // Charge Time Inputs
    this._setupTimeListeners('charge', this._entities.chargeStart, this._entities.chargeEnd);

    // Charge Power Slider
    const slider = q('#charge-power');
    if (slider && !slider.hasAttribute('data-listener-added')) {
        slider.setAttribute('data-listener-added', 'true');
        const powerValueDisplay = chargeSection.querySelector('.power-value');
        slider.addEventListener('input', e => { // Update display and style immediately on input
             const value = e.target.value;
             if (powerValueDisplay) powerValueDisplay.textContent = `${value}%`;
             this._updateSingleSliderStyle(slider); // Update track fill
        });
         slider.addEventListener('change', e => { // Send value to HA only on change (release)
             // Convert percentage to 0.1% increments (multiply by 10)
             this._setEntityValue(this._entities.chargePower, parseInt(e.target.value, 10) * 10, 'number');
         });
    }

    // Charge Day Checkboxes
    this._setupDayListeners('charge', this._entities.chargeDayMask);

    // New Charge Power Slider
    const newChargeSlider = q('#charge-power-slider');
    if (newChargeSlider && !newChargeSlider.hasAttribute('data-listener-added')) {
      newChargeSlider.setAttribute('data-listener-added', 'true');
      newChargeSlider.addEventListener('input', e => {
        const kwValue = parseFloat(e.target.value);
        const valueDisplay = q('#charge-power-value');
        if (valueDisplay) {
          valueDisplay.innerHTML = kwValue + '&nbsp;kW';
        }
        this._updateSingleSliderStyle(newChargeSlider);
      });
      newChargeSlider.addEventListener('change', e => {
        // Convert kW to percentage, then to 0.1% increments (multiply by 10)
        const kwValue = parseFloat(e.target.value);
        const percentValue = this._sliderKwToPercent(kwValue);
        this._setEntityValue(this._entities.chargePower, percentValue * 10, 'number');
      });
    }

    // Charge Timer Input
    const chargeTimer = q('#charge-timer');
    if (chargeTimer && !chargeTimer.hasAttribute('data-listener-added')) {
      chargeTimer.setAttribute('data-listener-added', 'true');
      // Store timer value in localStorage for persistence
      const savedValue = localStorage.getItem('saj-h2-charge-timer');
      if (savedValue) {
        chargeTimer.value = savedValue;
      }
      chargeTimer.addEventListener('change', e => {
        localStorage.setItem('saj-h2-charge-timer', e.target.value);
        this._updateEndTimeDisplay('charge', parseInt(e.target.value, 10));
      });
    }
    
    // Setup custom time selectors for charging
    this._setupTimeListeners('charge', this._entities.chargeStart, this._entities.chargeEnd);
  }

  // Add listeners for the discharging section
  // This version only calls the service, no optimistic UI updates.
  _addDischargingEventListeners() {
    const q = sel => this.shadowRoot.querySelector(sel);
    const dischargeSection = q('.discharging-section');
    if (!dischargeSection) return;

    // Discharge Enable Button
    const enableBtn = q('#discharging-enable');
    if (enableBtn && !enableBtn.hasAttribute('data-listener-added')) {
      enableBtn.setAttribute('data-listener-added', 'true');
      enableBtn.addEventListener('click', () => {
        const entityId = this._entities.dischargingSwitch;
        const currentState = this._hass.states[entityId]?.state;
        const timerInput = q('#discharge-timer');
        const dischargePowerSlider = q('#discharge-power-slider');
        const duration = timerInput ? parseInt(timerInput.value, 10) : 30;
        
        if (currentState === 'on') {
          // Extend functionality: Set end time to current time + duration
          const currentTime = this._getCurrentTime();
          const extendedEndTime = this._calculateEndTime(currentTime, duration);
          this._setEntityValue(this._entities.dischargeEnd, extendedEndTime, 'text');
        } else {
          // Enable functionality: Set new timer-based schedule
          // Convert kW slider value to percentage for entity
          const dischargePowerKw = dischargePowerSlider ? parseFloat(dischargePowerSlider.value) : 2.5;
          const dischargePower = this._sliderKwToPercent(dischargePowerKw);
          
          const startTime = this._getCurrentTime();
          const endTime = this._calculateEndTime(startTime, duration);
          const dayMask = this._getTodayDayMask();
          
          // Set the time schedule and power first
          this._setEntityValue(this._entities.dischargeStart, startTime, 'text');
          this._setEntityValue(this._entities.dischargeEnd, endTime, 'text');
          this._setEntityValue(this._entities.dischargeDayMask, dayMask, 'number');
          this._setEntityValue(this._entities.dischargePower, dischargePower, 'number');
          
          // Small delay to ensure time settings are processed before enabling
          setTimeout(() => {
            this._hass.callService('switch', 'turn_on', { entity_id: entityId });
          }, 100);
        }
      });
    }

    // Discharge Disable Button
    const disableBtn = q('#discharging-disable');
    if (disableBtn && !disableBtn.hasAttribute('data-listener-added')) {
      disableBtn.setAttribute('data-listener-added', 'true');
      disableBtn.addEventListener('click', () => {
        const entityId = this._entities.dischargingSwitch;
        this._hass.callService('switch', 'turn_off', { entity_id: entityId });
      });
    }

    // Discharge Power Slider
    const dischargeSlider = q('#discharge-power');
    if (dischargeSlider && !dischargeSlider.hasAttribute('data-listener-added')) {
        dischargeSlider.setAttribute('data-listener-added', 'true');
        const dischargeSection = dischargeSlider.closest('.discharging-section');
        const powerValueDisplay = dischargeSection?.querySelector('.power-value');
        dischargeSlider.addEventListener('input', e => { // Update display and style immediately on input
             const value = e.target.value;
             if (powerValueDisplay) powerValueDisplay.textContent = `${value}%`;
             this._updateSingleSliderStyle(dischargeSlider); // Update track fill
        });
         dischargeSlider.addEventListener('change', e => { // Send value to HA only on change (release)
             this._setEntityValue(this._entities.dischargePower, parseInt(e.target.value, 10), 'number');
         });
    }

    // Discharge Day Checkboxes
    this._setupDayListeners('discharge', this._entities.dischargeDayMask);

    // New Discharge Power Slider
    const newDischargeSlider = q('#discharge-power-slider');
    if (newDischargeSlider && !newDischargeSlider.hasAttribute('data-listener-added')) {
      newDischargeSlider.setAttribute('data-listener-added', 'true');
      newDischargeSlider.addEventListener('input', e => {
        const kwValue = parseFloat(e.target.value);
        const valueDisplay = q('#discharge-power-value');
        if (valueDisplay) {
          valueDisplay.innerHTML = kwValue + '&nbsp;kW';
        }
        this._updateSingleSliderStyle(newDischargeSlider);
      });
      newDischargeSlider.addEventListener('change', e => {
        // Convert kW to percentage
        const kwValue = parseFloat(e.target.value);
        const percentValue = this._sliderKwToPercent(kwValue);
        this._setEntityValue(this._entities.dischargePower, percentValue, 'number');
      });
    }

    // Discharge Timer Input
    const dischargeTimer = q('#discharge-timer');
    if (dischargeTimer && !dischargeTimer.hasAttribute('data-listener-added')) {
      dischargeTimer.setAttribute('data-listener-added', 'true');
      // Store timer value in localStorage for persistence
      const savedValue = localStorage.getItem('saj-h2-discharge-timer');
      if (savedValue) {
        dischargeTimer.value = savedValue;
      }
      dischargeTimer.addEventListener('change', e => {
        localStorage.setItem('saj-h2-discharge-timer', e.target.value);
        this._updateEndTimeDisplay('discharge', parseInt(e.target.value, 10));
      });
    }
    
    // Setup custom time selectors for discharging
    this._setupTimeListeners('discharge', this._entities.dischargeStart, this._entities.dischargeEnd);
  }

  // Helper to setup time input listeners
  _setupTimeListeners(prefix, startEntity, endEntity) {
    if (!this.shadowRoot) return;
    
    // Setup end time listener (simple time input like original)
    const endInput = this.shadowRoot.querySelector(`#${prefix}-end-time`);
    const timeField = this.shadowRoot.querySelector(`.clickable-time-field[data-time-input="${prefix}-end-time"]`);
    const timeValue = this.shadowRoot.querySelector(`.clickable-time-field[data-time-input="${prefix}-end-time"] .readonly-value`);
    
    if (endInput && !endInput.hasAttribute('data-listener-added')) {
      endInput.setAttribute('data-listener-added', 'true');
      
      const updateTimeDisplay = (timeValueStr) => {
        if (timeValue && /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeValueStr)) {
          const [hours, minutes] = timeValueStr.split(':').map(Number);
          const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
          const ampm = hours >= 12 ? 'PM' : 'AM';
          const displayTime = `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
          timeValue.textContent = displayTime;
        }
      };
      
      endInput.addEventListener('change', e => {
          if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(e.target.value)) {
               this._setEntityValue(endEntity, e.target.value, 'text');
               updateTimeDisplay(e.target.value);
          } else {
              console.warn(`[saj-h2-inverter-card] Invalid time format entered for ${endEntity}: ${e.target.value}. Reverting.`);
              const prevState = this._hass.states[endEntity]?.state;
               if (prevState && /^([01]\d|2[0-3]):([0-5]\d)$/.test(prevState)) {
                   e.target.value = prevState;
                   updateTimeDisplay(prevState);
               } else {
                   e.target.value = '00:00'; // Fallback
                   updateTimeDisplay('00:00');
               }
          }
      });
    }
    
    // Setup field click listener to trigger time picker
    if (timeField && !timeField.hasAttribute('data-listener-added')) {
      timeField.setAttribute('data-listener-added', 'true');
      timeField.addEventListener('click', () => {
        if (endInput && !endInput.disabled) {
          endInput.focus();
          // Try showPicker if available, otherwise just focus
          if (endInput.showPicker && typeof endInput.showPicker === 'function') {
            try {
              endInput.showPicker();
            } catch (e) {
              // Fallback if showPicker fails
              endInput.click();
            }
          } else {
            endInput.click();
          }
        }
      });
    }
  }
  


  // Helper to setup day checkbox listeners using event delegation
  _setupDayListeners(prefix, maskEntity) {
     if (!this.shadowRoot || !maskEntity) return;
     const container = this.shadowRoot.querySelector(`#${prefix}-day-mo`)?.closest('.days-selection, .days-select');

     if (container && !container.hasAttribute(`data-day-listener-${prefix}`)) {
        container.setAttribute(`data-day-listener-${prefix}`, 'true');
        container.addEventListener('change', (event) => {
            if (event.target.matches(`input[type="checkbox"][id^="${prefix}-day-"]`)) {
                let newMask = 0;
                container.querySelectorAll(`input[type="checkbox"][id^="${prefix}-day-"]`).forEach(cb => {
                    if (cb.checked) {
                        const dayIndex = parseInt(cb.dataset.dayIndex, 10);
                        if (!isNaN(dayIndex)) newMask |= (1 << dayIndex);
                    }
                });
                this._setEntityValue(maskEntity, newMask, 'number');
            }
        });
        // Mark initial checkboxes as having listener handled by container
        container.querySelectorAll(`input[type="checkbox"][id^="${prefix}-day-"]`).forEach(chk => {
            chk.setAttribute('data-listener-handled', 'true');
        });
     } else if (container) {
         // Ensure any dynamically added checkboxes are also marked (less likely scenario)
         container.querySelectorAll(`input[type="checkbox"][id^="${prefix}-day-"]:not([data-listener-handled])`).forEach(chk => {
             chk.setAttribute('data-listener-handled', 'true');
         });
     }
  }

  // Call HA service to set entity value
  _setEntityValue(entityId, value, domain = 'text') {
    if (!this._hass || !entityId) {
        console.error(`[saj-h2-inverter-card] Attempted to set invalid entity ID: ${entityId}`);
        return;
    }
    
    // Check if entity exists in Home Assistant
    if (!this._hass.states[entityId]) {
        console.error(`[saj-card] Entity ${entityId} does not exist in Home Assistant. Available entities:`, Object.keys(this._hass.states).filter(id => id.includes('saj')).slice(0, 10));
        return;
    }
    
    const service = domain === 'switch' ? `turn_${value}` : 'set_value';
    const serviceData = domain === 'switch' ? { entity_id: entityId } : { entity_id: entityId, value: value };

    console.log(`[saj-card] Calling ${domain}.${service} for ${entityId} with value: ${value}`);
    console.log(`[saj-card] Current entity state:`, this._hass.states[entityId]?.state);
    
    this._hass.callService(domain, service, serviceData)
      .then(() => {
        console.log(`[saj-card] ✓ Successfully set ${entityId} = ${value}`);
      })
      .catch(err => {
        console.error(`[saj-card] ✗ Error setting ${entityId}:`, err);
        this.dispatchEvent(new CustomEvent('hass-notification', {
            detail: { message: `Error setting ${entityId}: ${err.message}` },
            bubbles: true, composed: true
        }));
      });
  }

  // Calculate bitmask from day selection object
  _calculateDaymask(days) {
    const dayKeys = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    return dayKeys.reduce((sum, day, i) => sum + ((days && days[day]) ? (1 << i) : 0), 0);
  }


  // Get day selection object from bitmask
  _getDaysFromMask(mask) {
    const days = {};
    ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].forEach((day, i) => {
      days[day] = (mask & (1 << i)) !== 0;
    });
    return days;
  }

  // Get current time in HH:MM format
  _getCurrentTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  // Calculate end time based on start time and duration in minutes
  _calculateEndTime(startTime, durationMinutes) {
    const [hours, minutes] = startTime.split(':').map(Number);
    const startDate = new Date();
    startDate.setHours(hours, minutes, 0, 0);
    
    const endDate = new Date(startDate.getTime() + (durationMinutes * 60000));
    const endHours = String(endDate.getHours()).padStart(2, '0');
    const endMinutes = String(endDate.getMinutes()).padStart(2, '0');
    return `${endHours}:${endMinutes}`;
  }

  // Calculate day mask for today
  _getTodayDayMask() {
    const today = new Date().getDay(); // 0 = Sunday, 1 = Monday, etc.
    const dayIndex = today === 0 ? 6 : today - 1; // Convert to Monday=0, Sunday=6 format
    return 1 << dayIndex;
  }

  // Get timer value from localStorage or return default
  _getTimerValue(type, defaultValue) {
    const stored = localStorage.getItem(`saj-h2-${type}-timer`);
    return stored || defaultValue;
  }

  // Update end time display when timer duration changes
  _updateEndTimeDisplay(type, durationMinutes) {
    if (!this.shadowRoot) return;
    const endTimeDisplay = this.shadowRoot.querySelector(`#${type}-end-time-display`);
    if (endTimeDisplay) {
      const currentTime = this._getCurrentTime();
      const newEndTime = this._calculateEndTime(currentTime, durationMinutes);
      endTimeDisplay.textContent = newEndTime;
    }
  }

  // Set end time based on current time + duration when Set button is pressed
  _setEndTimeFromDuration(type) {
    if (!this.shadowRoot || !this._hass) return;
    
    // Get current time
    const now = new Date();
    const currentTimeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    // Get duration from input
    const timerInput = this.shadowRoot.querySelector(`#${type}-timer`);
    const durationMinutes = timerInput ? parseInt(timerInput.value, 10) : 30;
    
    // Get current power from slider
    const powerSlider = this.shadowRoot.querySelector(`#${type}-power-slider`);
    const currentPower = powerSlider ? parseInt(powerSlider.value, 10) : 50;
    
    // Calculate end time
    const endTime = this._calculateEndTime(currentTimeStr, durationMinutes);
    
    // Get today's day mask
    const dayMask = this._getTodayDayMask();
    
    // Get entity names
    const startEntity = type === 'charge' ? this._entities.chargeStart : this._entities.dischargeStart;
    const endEntity = type === 'charge' ? this._entities.chargeEnd : this._entities.dischargeEnd;
    const powerEntity = type === 'charge' ? this._entities.chargePower : this._entities.dischargePower;
    const dayMaskEntity = type === 'charge' ? this._entities.chargeDayMask : this._entities.dischargeDayMask;
    
    console.log(`[saj-card] Set ${type} button pressed:`);
    console.log(`[saj-card] - Time: ${currentTimeStr} to ${endTime} (${durationMinutes} minutes)`);
    console.log(`[saj-card] - Power: ${currentPower}%`);
    console.log(`[saj-card] - Day mask: ${dayMask} (today)`);
    console.log(`[saj-card] - Entities: Start=${startEntity}, End=${endEntity}, Power=${powerEntity}, DayMask=${dayMaskEntity}`);
    
    // Update all entities in Home Assistant
    this._setEntityValue(startEntity, currentTimeStr, 'text');
    this._setEntityValue(endEntity, endTime, 'text');
    this._setEntityValue(powerEntity, currentPower, 'number');
    this._setEntityValue(dayMaskEntity, dayMask, 'number');
    
    // Update the readonly display immediately (optimistic update)
    const endTimeDisplay = this.shadowRoot.querySelector(`#${type}-end-time-display`);
    if (endTimeDisplay) {
      endTimeDisplay.textContent = endTime;
      console.log(`[saj-card] Updated readonly display to ${endTime}`);
    }
    
    // Force a re-render after a short delay to ensure entity changes are reflected
    setTimeout(() => {
      if (this.shadowRoot && !this._isUserInteracting()) {
        this._renderCard();
        console.log(`[saj-card] Forced re-render after Set button`);
      }
    }, 500);
  }

  // Check if timers have expired and automatically turn off switches
  _checkTimerExpiration() {
    if (!this._hass) return;

    const currentTime = this._getCurrentTime();
    const currentTimeMinutes = this._timeToMinutes(currentTime);

    // Check charging timer expiration
    if (this._mode !== 'discharge') {
      const chargingSwitch = this._hass.states[this._entities.chargingSwitch];
      const chargeEndTime = this._hass.states[this._entities.chargeEnd];
      
      if (chargingSwitch?.state === 'on' && chargeEndTime?.state) {
        const endTimeMinutes = this._timeToMinutes(chargeEndTime.state);
        if (currentTimeMinutes >= endTimeMinutes) {
          console.log(`[saj-card] Charge timer expired at ${chargeEndTime.state}, turning off charging`);
          this._hass.callService('switch', 'turn_off', { 
            entity_id: this._entities.chargingSwitch 
          });
        }
      }
    }

    // Check discharging timer expiration
    if (this._mode !== 'charge') {
      const dischargingSwitch = this._hass.states[this._entities.dischargingSwitch];
      const dischargeEndTime = this._hass.states[this._entities.dischargeEnd];
      
      if (dischargingSwitch?.state === 'on' && dischargeEndTime?.state) {
        const endTimeMinutes = this._timeToMinutes(dischargeEndTime.state);
        if (currentTimeMinutes >= endTimeMinutes) {
          console.log(`[saj-card] Discharge timer expired at ${dischargeEndTime.state}, turning off discharging`);
          this._hass.callService('switch', 'turn_off', { 
            entity_id: this._entities.dischargingSwitch 
          });
        }
      }
    }
  }

  // Convert time string (HH:MM) to minutes for comparison
  _timeToMinutes(timeStr) {
    if (!timeStr || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(timeStr)) {
      return 0;
    }
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  // Update slider track fill based on current value
  _updateSingleSliderStyle(slider) {
      if (!slider) return;
      const min = parseFloat(slider.min) || 0;
      const max = parseFloat(slider.max) || 100;
      const value = parseFloat(slider.value) || 0;
      const percentage = max === min ? 0 : ((value - min) / (max - min)) * 100;
      slider.style.setProperty('--value-percent', `${percentage}%`);
  }

  // Update styles for all sliders after rendering
  _updateSliderStyles() {
      if (!this.shadowRoot) return;
      this.shadowRoot.querySelectorAll('.power-slider').forEach(slider => {
          this._updateSingleSliderStyle(slider);
      });
  }

  // Calculate the card size for Lovelace layout
  getCardSize() {
    let size = 1;
    if (this._mode !== 'discharge') size += 3; // Charging section
    if (this._mode !== 'charge') size += 3;    // Single discharging section
    return Math.max(1, Math.min(15, size));
  }

  // Runs when the element is added to the DOM
  connectedCallback() {
     if (this.shadowRoot && this._hass && !this.shadowRoot.innerHTML) {
        this._renderCard();
     }
  }

  // Helper function for deep merging configuration objects
  _deepMerge(target, source) {
      const isObject = (obj) => obj && typeof obj === 'object' && !Array.isArray(obj);
      if (!isObject(target) || !isObject(source)) {
          return source !== null && source !== undefined ? source : target;
      }
      const output = { ...target };
      Object.keys(source).forEach(key => {
          const targetValue = output[key];
          const sourceValue = source[key];
          if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
              output[key] = sourceValue; // Array replacement
          } else if (isObject(targetValue) && isObject(sourceValue)) {
              output[key] = this._deepMerge(targetValue, sourceValue);
          } else {
              output[key] = sourceValue;
          }
      });
       Object.keys(target).forEach(key => { // Ensure keys only in target are kept
            if (source[key] === undefined) {
                output[key] = target[key];
            }
       });
      return output;
  }


  // Static method to return the CSS styles
  _getStyles() {
    // CSS styles are encapsulated by Shadow DOM
    return `
      :host {
        display: block;
        --slider-track-color: var(--input-fill-color, #F0F0F0);
        --slider-thumb-color: var(--paper-slider-knob-color, var(--primary-color));
        --slider-active-color: var(--paper-slider-active-color, var(--primary-color));
        --error-color-rgb: var(--rgb-error-color, 211, 47, 47);
        --warning-color-rgb: var(--rgb-warning-color, 255, 152, 0);
        --primary-color-rgb: var(--rgb-primary-color, 33, 150, 243);
        --disabled-text-color-rgb: var(--rgb-disabled-text-color, 180, 180, 180);
      }
      ha-card {
        height: 100%; display: flex; flex-direction: column;
        justify-content: space-between; overflow: hidden;
      }
      .card-content { padding: 16px; flex-grow: 1; }
      .card-error {
        background-color: var(--error-color); color: var(--text-primary-color-on-error, white);
        padding: 12px; border-radius: 8px; margin-bottom: 16px;
      }
      .card-error h2 { margin: 0 0 8px 0; font-size: 1.1em; color: var(--text-primary-color-on-error, white); }
      .card-error p { margin: 0; font-size: 0.9em; word-break: break-all; color: var(--text-primary-color-on-error, white); }
      ha-alert { display: block; margin-bottom: 16px; }
      ha-alert[alert-type="warning"] { --alert-warning-color: var(--warning-color); }
      ha-alert[alert-type="error"] { --alert-error-color: var(--error-color); }
      .section { margin-bottom: 24px; }
      .charging-section, .discharging-section {
        border: 1px solid var(--divider-color); border-radius: 12px;
        padding: 16px; background-color: var(--card-background-color);
      }
      .section-header {
        font-size: 1.25rem; font-weight: 500; margin: -16px -16px 16px -16px;
        padding: 12px 16px; color: var(--primary-text-color);
        border-bottom: 1px solid var(--divider-color);
        background-color: var(--app-header-background-color, var(--secondary-background-color));
        border-radius: 12px 12px 0 0; letter-spacing: 0.5px;
      }
      .subsection { margin-bottom: 20px; }
      .subsection:last-child { margin-bottom: 0; }
      .subsection-header { font-size: 1.1rem; font-weight: 500; margin-bottom: 12px; color: var(--primary-text-color); }

      /* Time and Power Row */
      .time-box-container {
        display: flex; align-items: stretch; justify-content: space-between;
        width: 100%; background-color: var(--secondary-background-color);
        border-radius: 12px; padding: 16px; margin-bottom: 12px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05); gap: 16px; box-sizing: border-box;
      }
      .time-box { display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 80px; }
      .power-time { flex: 0 1 auto; min-width: 70px; justify-content: center; }
      .time-box-label {
        font-size: 0.9em; font-weight: 500; margin-bottom: 6px;
        color: var(--secondary-text-color); text-transform: uppercase;
        letter-spacing: 0.5px; white-space: nowrap;
      }
      .time-input-container {
        display: flex; align-items: center; border: 1px solid var(--input-ink-color, var(--divider-color));
        border-radius: 8px; padding: 0 6px; background-color: var(--input-fill-color, var(--card-background-color));
        width: 100%; min-height: 40px; box-sizing: border-box; transition: background-color 0.2s ease, border-color 0.2s ease;
      }
      .time-input-container:hover:not(:has(input:disabled)) { border-color: var(--input-hover-ink-color, var(--primary-color)); }
      .time-input {
        flex-grow: 1; padding: 8px 4px; border: none; background-color: transparent; color: var(--primary-text-color);
        font-size: 1.1em; font-weight: 500; text-align: center; min-width: 70px; outline: none; color-scheme: light dark;
      }
      .time-input:disabled { color: var(--disabled-text-color); cursor: not-allowed; }
      
      /* Custom Time Selector Styles */
      .custom-time-container {
        display: flex; align-items: center; justify-content: center; gap: 4px;
        padding: 4px 8px; border: 1px solid var(--input-ink-color, var(--divider-color));
        border-radius: 8px; background-color: var(--input-fill-color, var(--card-background-color));
        width: 100%; min-height: 40px; box-sizing: border-box;
      }
      .time-select {
        border: none; background: transparent; color: var(--primary-text-color);
        font-size: 1em; font-weight: 500; outline: none; cursor: pointer;
        padding: 2px 4px; text-align: center;
      }
      .hour-select, .minute-select { min-width: 35px; }
      .ampm-select { min-width: 45px; font-size: 0.9em; }
      .time-separator {
        color: var(--primary-text-color); font-weight: bold; margin: 0 2px;
      }
      .time-select:disabled {
        color: var(--disabled-text-color); cursor: not-allowed;
      }
      .custom-time-container:has(.time-select:disabled) {
        background-color: var(--input-disabled-fill-color, rgba(var(--disabled-text-color-rgb), 0.1));
        border-color: var(--input-disabled-ink-color, var(--divider-color));
      }
      .time-input-container:has(input:disabled) {
        background-color: var(--input-disabled-fill-color, rgba(var(--disabled-text-color-rgb), 0.1));
        border-color: var(--input-disabled-ink-color, var(--divider-color)); cursor: not-allowed;
      }
      .power-placeholder { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 40px; box-sizing: border-box; }
      .power-value {
        display: inline-flex; align-items: center; justify-content: center; padding: 8px 12px;
        border: 1px solid var(--input-ink-color, var(--divider-color)); border-radius: 8px;
        background-color: var(--input-fill-color, var(--card-background-color)); font-size: 1.1em; font-weight: 500;
        color: var(--primary-text-color); width: 80px; min-height: 40px; box-sizing: border-box; text-align: center;
        transition: background-color 0.2s ease, border-color 0.2s ease;
      }
      
      /* Time Bubble Styles */
      .time-display-container {
        display: flex; flex-direction: column; align-items: center; width: 100%;
        margin-bottom: 12px;
      }
      .time-bubble {
        background: linear-gradient(135deg, var(--primary-color), var(--accent-color, var(--primary-color)));
        border-radius: 16px; padding: 16px 24px; cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: all 0.3s ease;
        border: none; display: flex; flex-direction: column; align-items: center;
        min-width: 120px; position: relative; overflow: hidden;
      }
      .time-bubble:hover {
        transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.2);
      }
      .time-bubble:active { transform: translateY(0); }
      .time-bubble-label {
        color: rgba(255,255,255,0.9); font-size: 0.8em; font-weight: 500;
        text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;
      }
      .time-bubble-value {
        color: white; font-size: 1.3em; font-weight: 600; line-height: 1;
      }
      .time-input-hidden {
        position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none;
      }
      
      /* Clickable time field styles */
      .clickable-time-field {
        cursor: pointer; 
        transition: background-color 0.2s ease;
      }
      .clickable-time-field:hover {
        background-color: var(--secondary-background-color);
      }
      .time-box.power-time:has(input:disabled) .power-value, /* If parent time box input is disabled */
      .time-power-row:has(input.power-slider:disabled) .power-value /* If sibling slider is disabled */
       {
        background-color: var(--input-disabled-fill-color, rgba(var(--disabled-text-color-rgb), 0.1));
        border-color: var(--input-disabled-ink-color, var(--divider-color)); color: var(--disabled-text-color);
      }

      /* Read-only Fields */
      .readonly-container {
        padding: 12px 16px; background-color: var(--secondary-background-color);
        border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--divider-color);
        display: flex; flex-direction: column; gap: 12px;
      }
      .status-line {
        display: flex; justify-content: center; align-items: center;
      }
      .status-text {
        font-size: 1em; font-weight: 500;
      }
      .status-text.status-active {
        color: var(--success-color, #4caf50);
      }
      .status-text.status-inactive {
        color: var(--error-color, #f44336);
      }
      .status-text.status-pending {
        color: var(--warning-color, #ff9800);
        animation: pulse 1.5s infinite ease-in-out;
      }
      .data-line {
        display: flex; gap: 16px; justify-content: space-around;
      }
      .readonly-field {
        display: flex; align-items: center; gap: 8px; flex: 1;
        justify-content: center;
      }
      .readonly-label {
        font-size: 0.9em; color: var(--secondary-text-color);
        font-weight: 500; white-space: nowrap;
      }
      .readonly-value {
        font-size: 0.9em !important; font-weight: 400 !important; color: var(--primary-text-color);
        padding: 8px 12px; background-color: var(--input-fill-color, var(--card-background-color));
        border-radius: 8px; min-width: 60px; text-align: center;
        border: 1px solid var(--input-ink-color, var(--divider-color));
      }

      /* Combined Controls Container */
      .controls-container {
        padding: 16px; background-color: var(--secondary-background-color);
        border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--divider-color);
        display: flex; flex-direction: column; gap: 16px;
      }
      .power-control, .timer-control {
        display: flex; align-items: center; gap: 8px; padding-right: 12px;
      }
      .control-label {
        font-size: 1em; font-weight: 500; color: var(--primary-text-color);
        white-space: nowrap; min-width: 140px;
      }

      /* Section Headings */
      .section-title {
        font-size: 1.1em; font-weight: 600; color: var(--primary-text-color);
        margin: 0 0 16px 0; padding-bottom: 8px; 
        border-bottom: 2px solid var(--primary-color);
        text-transform: uppercase; letter-spacing: 0.5px;
      }

      /* Slider Container */
      .slider-container {
        display: flex; align-items: center; gap: 12px; margin-bottom: 12px;
      }
      .slider-container:last-child {
        margin-bottom: 0;
      }

      .timer-input {
        padding: 8px 12px; border: 1px solid var(--input-ink-color, var(--divider-color));
        border-radius: 6px; background-color: var(--input-fill-color, var(--card-background-color));
        color: var(--primary-text-color); font-size: 1em; outline: none; width: 60px;
        transition: border-color 0.2s ease; text-align: center;
      }
      .timer-input:hover { border-color: var(--input-hover-ink-color, var(--primary-color)); }
      .timer-input:focus { border-color: var(--primary-color); box-shadow: 0 0 0 2px rgba(var(--primary-color-rgb), 0.2); }

      .set-btn {
        background: var(--primary-color);
        color: var(--text-primary-color);
        border: none;
        border-radius: 4px;
        padding: 6px 10px;
        font-size: 12px;
        cursor: pointer;
        margin-right: 8px;
        transition: all 0.2s ease;
        height: 32px;
        min-width: 40px;
      }
      .set-btn:hover {
        background: var(--primary-color);
        opacity: 0.8;
        transform: translateY(-1px);
      }
      .set-btn:active {
        transform: translateY(0px);
      }

      /* Days Selection */
      .days-selection, .days-select { display: flex; flex-wrap: wrap; gap: 10px 10px; margin-bottom: 12px; justify-content: flex-start; }
      .day-checkbox { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 4px 8px; border-radius: 12px; transition: background-color 0.2s ease; }
      .day-checkbox:not(.disabled):hover { background-color: rgba(var(--primary-color-rgb), 0.1); }
      .day-checkbox span { font-size: 1em; user-select: none;}
      .day-checkbox input[type="checkbox"] { width: 18px; height: 18px; margin-right: 4px; cursor: pointer; accent-color: var(--primary-color); }
      .day-checkbox input[type="checkbox"]:disabled { cursor: not-allowed; accent-color: var(--disabled-text-color); opacity: 0.7; }
      .day-checkbox.disabled { cursor: not-allowed; color: var(--disabled-text-color); opacity: 0.7; }

      /* Slider */
      .time-power-container { display: flex; flex-direction: column; margin-bottom: 12px; }
      .time-power-row { display: flex; align-items: center; justify-content: flex-start; gap: 16px; margin-bottom: 12px; }
      .slider-container { width: 100%; padding: 0 8px; box-sizing: border-box; margin-top: 8px;}
      .power-slider {
        width: 100%; height: 8px; cursor: pointer; appearance: none;
        /* Track fill using CSS variable set by JS */
        background: linear-gradient(to right, var(--slider-active-color) 0%, var(--slider-active-color) var(--value-percent, 0%), var(--slider-track-color) var(--value-percent, 0%), var(--slider-track-color) 100%);
        border-radius: 4px; outline: none; transition: background .1s ease-in-out; margin: 8px 0;
      }
      .power-slider::-webkit-slider-thumb { appearance: none; width: 20px; height: 20px; background: var(--slider-thumb-color); border-radius: 50%; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
      .power-slider::-moz-range-thumb { width: 20px; height: 20px; background: var(--slider-thumb-color); border-radius: 50%; cursor: pointer; border: none; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
      .power-slider:disabled { background: var(--input-disabled-fill-color, #E0E0E0); cursor: not-allowed; opacity: 0.6; }
      .power-slider:disabled::-webkit-slider-thumb { background: var(--disabled-text-color); cursor: not-allowed; box-shadow: none; }
      .power-slider:disabled::-moz-range-thumb { background: var(--disabled-text-color); cursor: not-allowed; box-shadow: none; }

      /* Combined Controls Container */
      .controls-container {
        padding: 16px; background-color: var(--secondary-background-color);
        border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--divider-color);
        display: flex; flex-direction: column; gap: 16px;
      }
      .power-control {
        display: flex; align-items: center; gap: 12px;
      }
      .timer-control {
        display: grid; grid-template-columns: 140px 80px 1fr 1fr; align-items: center; gap: 12px;
      }
      .control-label {
        font-size: 1em; font-weight: 500; color: var(--primary-text-color);
        white-space: nowrap; text-align: left;
      }
      .power-value {
        min-width: 50px; text-align: center; font-weight: bold;
        color: var(--primary-text-color); font-size: 0.95em;
      }

      /* Control Button & Status */
      .control-button {
        width: 100%; padding: 14px; font-size: 1.1rem; border-radius: 8px; border: none;
        background-color: var(--primary-color); color: var(--text-primary-color-on-primary, white); font-weight: 500;
        cursor: pointer; margin-bottom: 10px; transition: all 0.2s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      .control-button:hover:not(:disabled) { filter: brightness(110%); box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
      .control-button:active:not(:disabled) { transform: scale(0.98); }
      .control-button.active { background-color: var(--error-color); }
      .control-button.active:hover:not(:disabled) { background-color: var(--error-color); filter: brightness(110%); }
      .control-button:disabled {
          background-color: var(--disabled-text-color); color: var(--text-primary-color-on-disabled, #FAFAFA);
          cursor: not-allowed; box-shadow: none; opacity: 0.7;
      }

      /* Enable/Disable Buttons in Timer Control */
      .enable-btn, .disable-btn {
        width: auto; padding: 8px 16px; font-size: 0.9rem; border-radius: 6px; border: none;
        font-weight: 500; cursor: pointer; margin-bottom: 0; transition: all 0.2s ease; 
        box-shadow: 0 1px 3px rgba(0,0,0,0.1); min-width: 70px;
      }
      .enable-btn {
        background-color: var(--success-color, #4caf50); 
        color: var(--text-primary-color-on-success, white);
      }
      .disable-btn {
        background-color: var(--error-color, #f44336); 
        color: var(--text-primary-color-on-error, white);
      }
      .enable-btn:hover:not(:disabled) { filter: brightness(110%); box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
      .disable-btn:hover:not(:disabled) { filter: brightness(110%); box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
      .enable-btn:active:not(:disabled), .disable-btn:active:not(:disabled) { transform: scale(0.98); }
      .enable-btn:disabled, .disable-btn:disabled {
        background-color: var(--disabled-text-color); color: var(--text-primary-color-on-disabled, #FAFAFA);
        cursor: not-allowed; box-shadow: none; opacity: 0.7;
      }

      .status-display {
          text-align: center; font-size: 0.95em; color: var(--secondary-text-color); min-height: 30px;
          display: flex; flex-direction: column; justify-content: center; align-items: center;
      }
      .status-value { font-weight: 500; transition: color 0.3s ease; }
      .status-value.active { color: var(--success-color, MediumSeaGreen); }
      .status-value.inactive { color: var(--error-color, Tomato); }
      .wait-message { /* Specific style for the wait message */
        font-weight: 500; color: var(--warning-color); padding: 6px 0 0 0;
        text-align: center; font-size: 0.9em; animation: pulse 1.5s infinite ease-in-out;
      }
      @keyframes pulse { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }



      /* Responsive adjustments */
      @media (max-width: 450px) {
        .card-content { padding: 12px; }
        .readonly-container { gap: 10px; padding: 10px 12px; }
        .data-line { flex-direction: column; gap: 8px; }
        .readonly-field { justify-content: flex-start; gap: 8px; }
        .readonly-value { min-width: 50px; font-size: 1.1em; }
        .status-text { font-size: 1em; padding: 6px 12px; }
        .status-text.status-active, .status-text.status-inactive, .status-text.status-pending { border-width: 1px; }
        .controls-container { padding: 12px; gap: 12px; }
        .power-control, .timer-control { flex-direction: column; align-items: stretch; gap: 8px; }
        .control-label { text-align: center; min-width: auto; }
        .timer-input { max-width: none; text-align: center; }
        .power-value { text-align: center; }
        .control-button { font-size: 1rem; padding: 12px; }
      }
    `;
  }
}

// Register the custom element
customElements.define('saj-h2-inverter-card-timer', SajH2InverterCardTimer);

// Add card to custom card list for UI editor (run only once)
if (!window.sajH2CardTimerDefined) {
    window.customCards = window.customCards || [];
    window.customCards.push({
      type: 'saj-h2-inverter-card-timer',
      name: 'SAJ H2 Inverter Card Timer',
      description: 'Card for controlling SAJ H2 inverter charge/discharge settings with timer functionality.',
      preview: true,
      documentationURL: 'https://github.com/stanu74/saj-h2-ha-card' // Adjust if needed
    });
    window.sajH2CardTimerDefined = true;
}
