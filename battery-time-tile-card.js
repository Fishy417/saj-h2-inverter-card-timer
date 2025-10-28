/**
 * Battery Time to Full/Empty Tile Card
 * Shows time to fully charged or discharged based on current power flow
 * @version 1.0.1
 */

class BatteryTimeTileCard extends HTMLElement {
  static VERSION = '1.0.1';

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  static getStubConfig() {
    return {
      type: 'custom:battery-time-tile-card',
      battery_capacity: 40, // kWh
      slim_mode: false, // Set to true to hide battery icon and power flow row
      entities: {
        battery_soc: 'sensor.battery_state_of_charge', // Battery % (0-100)
        battery_power: 'sensor.battery_power', // Watts (Negative = charging, Positive = discharging)
      }
    };
  }

  setConfig(config) {
    if (!config || !config.entities) {
      throw new Error('You need to define entities');
    }
    this._config = config;
    this._entities = config.entities;
    this._batteryCapacity = config.battery_capacity || 40; // Default 40kWh
    this._slimMode = config.slim_mode || false;
  }

  set hass(hass) {
    this._hass = hass;
    this._renderCard();
  }

  _renderCard() {
    if (!this._hass || !this.shadowRoot) return;

    const entities = this._hass.states;
    
    // Get battery state of charge (%)
    const socEntity = entities[this._entities.battery_soc];
    const soc = socEntity ? parseFloat(socEntity.state) : 0;
    
    // Get battery power in Watts (negative = charging, positive = discharging)
    const powerEntity = entities[this._entities.battery_power];
    const powerWatts = powerEntity ? parseFloat(powerEntity.state) : 0;
    
    // Convert to kW and invert sign (negative becomes positive for charging)
    const power = -powerWatts / 1000;
    
    // Calculate time to full or empty
    const timeData = this._calculateTimeToFullOrEmpty(soc, power);
    
    this.shadowRoot.innerHTML = `
      <style>
        ${this._getStyles()}
      </style>
      <ha-card>
        <div class="card-content ${this._slimMode ? 'slim-mode' : ''}">
          ${!this._slimMode ? `
          <!-- Battery Status Row -->
          <div class="battery-status-row">
            <div class="battery-icon-container">
              ${this._getBatteryIcon(soc, power)}
            </div>
            <div class="battery-info">
              <div class="battery-soc">${soc.toFixed(0)}%</div>
              <div class="battery-label">Battery</div>
            </div>
          </div>
          
          <!-- Power Flow Row -->
          <div class="power-flow-row">
            <div class="power-indicator ${timeData.status}">
              <span class="power-icon">${timeData.icon}</span>
              <span class="power-value">${Math.abs(power).toFixed(2)} kW</span>
            </div>
            <div class="power-label">${timeData.label}</div>
          </div>
          ` : ''}
          
          <!-- Time Estimate Row -->
          <div class="time-estimate-row">
            <div class="time-box ${timeData.status}">
              <div class="time-label">${timeData.timeLabel}</div>
              <div class="time-value">${timeData.timeDisplay}</div>
            </div>
          </div>
          
          <!-- Energy Details -->
          <div class="energy-details">
            <div class="detail-item">
              <span class="detail-label">Total Capacity:</span>
              <span class="detail-value">${this._batteryCapacity} kWh</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Stored Energy:</span>
              <span class="detail-value">${(this._batteryCapacity * soc / 100).toFixed(1)} kWh</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">${timeData.remainingLabel}:</span>
              <span class="detail-value">${timeData.remainingEnergy} ${this._slimMode ? '' : 'kWh'}</span>
            </div>
          </div>
        </div>
      </ha-card>
    `;
  }

  _calculateTimeToFullOrEmpty(soc, power) {
    const currentEnergy = (this._batteryCapacity * soc / 100);
    
    // If power is near zero, show idle state
    if (Math.abs(power) < 0.1) {
      return {
        status: 'idle',
        icon: '⏸️',
        label: 'Battery Idle',
        timeLabel: 'Status',
        timeDisplay: 'No Active Flow',
        remainingLabel: 'Available Now',
        remainingEnergy: currentEnergy.toFixed(1)
      };
    }
    
    // Charging (positive power after inversion)
    if (power > 0) {
      const energyToFull = this._batteryCapacity - currentEnergy;
      const hoursToFull = energyToFull / power;
      
      return {
        status: 'charging',
        icon: '⚡',
        label: 'Charging',
        timeLabel: 'Time to Full',
        timeDisplay: this._formatTime(hoursToFull),
        remainingLabel: 'Space Left',
        remainingEnergy: energyToFull.toFixed(1)
      };
    }
    
    // Discharging (negative power after inversion)
    if (power < 0) {
      const hoursToEmpty = currentEnergy / Math.abs(power);
      
      return {
        status: 'discharging',
        icon: '🔋',
        label: 'Discharging',
        timeLabel: 'Time to Empty',
        timeDisplay: this._formatTime(hoursToEmpty),
        remainingLabel: 'Time @ Rate',
        remainingEnergy: this._formatTime(hoursToEmpty)
      };
    }
  }

  _formatTime(hours) {
    if (!isFinite(hours) || hours < 0) {
      return '--:--';
    }
    
    // If more than 24 hours, show in days
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = Math.floor(hours % 24);
      return `${days}d ${remainingHours}h`;
    }
    
    // If more than 1 hour, show hours and minutes
    if (hours >= 1) {
      const h = Math.floor(hours);
      const m = Math.floor((hours - h) * 60);
      return `${h}h ${m}m`;
    }
    
    // Less than 1 hour, show just minutes
    const minutes = Math.floor(hours * 60);
    return `${minutes} min`;
  }

  _getBatteryIcon(soc, power) {
    // Determine battery fill level
    let fillLevel = 'empty';
    if (soc > 80) fillLevel = 'full';
    else if (soc > 60) fillLevel = 'high';
    else if (soc > 40) fillLevel = 'medium';
    else if (soc > 20) fillLevel = 'low';
    
    // Determine if charging
    const isCharging = power > 0.1;
    const chargingClass = isCharging ? 'charging-animation' : '';
    
    return `
      <div class="battery-icon ${fillLevel} ${chargingClass}">
        <div class="battery-body">
          <div class="battery-fill" style="width: ${soc}%"></div>
          ${isCharging ? '<span class="charging-bolt">⚡</span>' : ''}
        </div>
        <div class="battery-terminal"></div>
      </div>
    `;
  }

  _getStyles() {
    return `
      :host {
        display: block;
      }
      
      ha-card {
        padding: 0;
        overflow: hidden;
      }
      
      .card-content {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      
      .card-content.slim-mode {
        gap: 12px;
        padding: 12px;
      }
      
      /* Battery Status Row */
      .battery-status-row {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      
      .battery-icon-container {
        flex-shrink: 0;
      }
      
      .battery-icon {
        width: 60px;
        height: 32px;
        position: relative;
        display: flex;
        align-items: center;
      }
      
      .battery-body {
        width: 50px;
        height: 28px;
        border: 2px solid var(--primary-text-color);
        border-radius: 4px;
        position: relative;
        overflow: hidden;
        background: var(--card-background-color);
      }
      
      .battery-fill {
        height: 100%;
        transition: width 0.3s ease, background-color 0.3s ease;
        position: absolute;
        left: 0;
        top: 0;
      }
      
      .battery-icon.full .battery-fill {
        background: linear-gradient(to right, #4caf50, #66bb6a);
      }
      
      .battery-icon.high .battery-fill {
        background: linear-gradient(to right, #8bc34a, #9ccc65);
      }
      
      .battery-icon.medium .battery-fill {
        background: linear-gradient(to right, #ffc107, #ffca28);
      }
      
      .battery-icon.low .battery-fill {
        background: linear-gradient(to right, #ff9800, #ffa726);
      }
      
      .battery-icon.empty .battery-fill {
        background: linear-gradient(to right, #f44336, #ef5350);
      }
      
      .battery-terminal {
        width: 4px;
        height: 16px;
        background: var(--primary-text-color);
        border-radius: 0 2px 2px 0;
        position: absolute;
        right: -6px;
        top: 50%;
        transform: translateY(-50%);
      }
      
      .charging-bolt {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 16px;
        z-index: 10;
        animation: pulse 1s infinite;
      }
      
      .charging-animation .battery-fill {
        animation: charging-pulse 2s infinite;
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        50% { opacity: 0.7; transform: translate(-50%, -50%) scale(1.1); }
      }
      
      @keyframes charging-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
      
      .battery-info {
        flex: 1;
      }
      
      .battery-soc {
        font-size: 2em;
        font-weight: bold;
        color: var(--primary-text-color);
        line-height: 1;
      }
      
      .battery-label {
        font-size: 0.9em;
        color: var(--secondary-text-color);
        margin-top: 4px;
      }
      
      /* Power Flow Row */
      .power-flow-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: var(--secondary-background-color);
        border-radius: 8px;
      }
      
      .power-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 6px;
        font-weight: 500;
      }
      
      .power-indicator.charging {
        background: rgba(76, 175, 80, 0.1);
        border: 1px solid rgba(76, 175, 80, 0.3);
      }
      
      .power-indicator.discharging {
        background: rgba(255, 152, 0, 0.1);
        border: 1px solid rgba(255, 152, 0, 0.3);
      }
      
      .power-indicator.idle {
        background: rgba(158, 158, 158, 0.1);
        border: 1px solid rgba(158, 158, 158, 0.3);
      }
      
      .power-icon {
        font-size: 1.2em;
      }
      
      .power-value {
        font-size: 1.1em;
        font-weight: 600;
        color: var(--primary-text-color);
      }
      
      .power-label {
        flex: 1;
        font-size: 0.9em;
        color: var(--secondary-text-color);
      }
      
      /* Time Estimate Row */
      .time-estimate-row {
        display: flex;
        justify-content: center;
      }
      
      .time-box {
        padding: 16px 24px;
        border-radius: 12px;
        text-align: center;
        min-width: 200px;
      }
      
      .time-box.charging {
        background: linear-gradient(135deg, rgba(76, 175, 80, 0.2), rgba(76, 175, 80, 0.1));
        border: 2px solid rgba(76, 175, 80, 0.4);
      }
      
      .time-box.discharging {
        background: linear-gradient(135deg, rgba(255, 152, 0, 0.2), rgba(255, 152, 0, 0.1));
        border: 2px solid rgba(255, 152, 0, 0.4);
      }
      
      .time-box.idle {
        background: linear-gradient(135deg, rgba(158, 158, 158, 0.2), rgba(158, 158, 158, 0.1));
        border: 2px solid rgba(158, 158, 158, 0.4);
      }
      
      .time-label {
        font-size: 0.85em;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
      }
      
      .time-value {
        font-size: 2em;
        font-weight: bold;
        color: var(--primary-text-color);
        line-height: 1;
      }
      
      .slim-details {
        display: flex;
        gap: 12px;
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(var(--rgb-primary-text-color), 0.1);
        font-size: 0.8em;
        justify-content: center;
        align-items: center;
      }
      
      .slim-power {
        color: var(--secondary-text-color);
      }
      
      .slim-soc {
        color: var(--primary-text-color);
        font-weight: 600;
        padding: 2px 8px;
        background: rgba(var(--rgb-primary-text-color), 0.1);
        border-radius: 4px;
      }
      
      /* Energy Details */
      .energy-details {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        padding: 12px;
        background: var(--secondary-background-color);
        border-radius: 8px;
      }
      
      .detail-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      
      .detail-label {
        font-size: 0.75em;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }
      
      .detail-value {
        font-size: 1em;
        font-weight: 600;
        color: var(--primary-text-color);
      }
      
      /* Responsive */
      @media (max-width: 450px) {
        .card-content {
          padding: 12px;
          gap: 12px;
        }
        
        .battery-soc {
          font-size: 1.8em;
        }
        
        .time-box {
          min-width: 160px;
          padding: 12px 20px;
        }
        
        .time-value {
          font-size: 1.6em;
        }
        
        .energy-details {
          grid-template-columns: 1fr;
          gap: 6px;
        }
        
        .detail-item {
          flex-direction: row;
          justify-content: space-between;
        }
      }
    `;
  }

  getCardSize() {
    return this._slimMode ? 2 : 3;
  }
}

// Register the custom element
customElements.define('battery-time-tile-card', BatteryTimeTileCard);

// Add to window for HACS/manual installations
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'battery-time-tile-card',
  name: 'Battery Time Tile Card',
  description: 'Shows time to fully charged or discharged based on current battery power flow',
  preview: true
});

console.info(
  `%c  BATTERY-TIME-TILE-CARD %c v${BatteryTimeTileCard.VERSION} `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray'
);
