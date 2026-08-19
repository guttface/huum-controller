import {HuumEvents, UserEvents} from '../events/eventEnum.ts'
import eventBus from '../events/eventbus.ts'

const HTTP_PORT: string = process.env.HTTP_PORT || '8080'
const HTTP_HOSTNAME: string = process.env.HTTP_HOSTNAME || '0.0.0.0'

// state used to build /status
let currentTemperature: number = 0
let sensorReadingTimestamp: number | null = null
let lastHandshakeTimestamp: number | null = null
let temperatureSetpoint: number | null = null
let heatingStartMs: number = 0
let heatingEndMs: number = 0

const STALE_MS = 3 * 60 * 1000 // 3 minutes

Bun.serve({
    port: HTTP_PORT,
    hostname: HTTP_HOSTNAME,
    routes: {
        '/status': {
            GET: async () => {
                const now = Date.now()
                const lastActivity = Math.max(sensorReadingTimestamp ?? 0, lastHandshakeTimestamp ?? 0)
                const isOnline = lastActivity > 0 && (now - lastActivity) <= STALE_MS

                const isHeating = heatingStartMs !== 0 && heatingEndMs !== 0

                const payload = {
                    temperature: currentTemperature,
                    sensorReadingTimestamp: sensorReadingTimestamp ?? null,
                    temperatureSetpoint: temperatureSetpoint,
                    isOnline,
                    isHeating,
                    heatingEndTime: heatingEndMs || null,
                }

                return new Response(JSON.stringify(payload), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                })
            },
        },

        '/start': {
            POST: async req => {
                const request = await req.json() as TurnOnRequest
                // update setpoint from user request
                if (typeof request.targetTemperature === 'number') temperatureSetpoint = request.targetTemperature
                eventBus.emit(UserEvents.TURN_ON, request)
                return new Response('OK', {status: 200})
            },
        },

        '/stop': {
            POST: async req => {
                const request = await req.json() as TurnOffRequest
                // keep last known setpoint
                eventBus.emit(UserEvents.TURN_OFF, request)
                return new Response('OK', {status: 200})
            },
        },
    },
})

eventBus.on(HuumEvents.SENSOR_READING, (update: SensorUpdate) => {
    currentTemperature = update.temperature
    sensorReadingTimestamp = Date.now()
    // If the controller sends a setpoint in future sensor updates, update temperatureSetpoint here
    console.log(`Sensor reading: ${JSON.stringify(update)}`)
})

eventBus.on(HuumEvents.HANDSHAKE, () => {
    lastHandshakeTimestamp = Date.now()
})

/*
  The tcp server emits HuumEvents.HEATING with {heatingStartMs, heatingEndMs}
  when it receives the 0x07/0x08 messages. Update local variables accordingly.
*/
eventBus.on(HuumEvents.HEATING, (h: {heatingStartMs: number, heatingEndMs: number}) => {
    heatingStartMs = h.heatingStartMs
    heatingEndMs = h.heatingEndMs
    console.log(`Heating info updated: start=${heatingStartMs}, end=${heatingEndMs}`)
})

console.log(`🚀 HTTP server listening on ${HTTP_HOSTNAME}:${HTTP_PORT}`)
