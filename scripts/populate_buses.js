import { query } from '../src/db.js';

async function populateBusTrips() {
  try {
    // Clear existing shows and related data
    console.log('Clearing existing data...');
    await query('DELETE FROM seats');
    await query('DELETE FROM bookings');
    await query('DELETE FROM shows');
    await query('ALTER SEQUENCE shows_id_seq RESTART WITH 1');
    await query('ALTER SEQUENCE bookings_id_seq RESTART WITH 1');
    await query('ALTER SEQUENCE seats_id_seq RESTART WITH 1');

    // Generate bus trips for next 5 days
    console.log('Creating bus trips for next 5 days...');
    const today = new Date();
    
    for (let day = 0; day < 5; day++) {
      const tripDate = new Date(today);
      tripDate.setDate(today.getDate() + day);
      
      // Bus 1: Morning trip (9:00 AM)
      const morning = new Date(tripDate);
      morning.setHours(9, 0, 0, 0);
      
      const morningBus = await query(
        'INSERT INTO shows (name, start_time, total_seats) VALUES ($1, $2, $3) RETURNING id',
        [`Morning Bus - ${tripDate.toDateString()}`, morning.toISOString(), 40]
      );
      
      // Bus 2: Evening trip (6:00 PM)
      const evening = new Date(tripDate);
      evening.setHours(18, 0, 0, 0);
      
      const eveningBus = await query(
        'INSERT INTO shows (name, start_time, total_seats) VALUES ($1, $2, $3) RETURNING id',
        [`Evening Bus - ${tripDate.toDateString()}`, evening.toISOString(), 40]
      );
      
      // Create seats for morning bus
      for (let seat = 1; seat <= 40; seat++) {
        await query(
          'INSERT INTO seats (show_id, seat_number, status) VALUES ($1, $2, $3)',
          [morningBus.rows[0].id, seat, 'available']
        );
      }
      
      // Create seats for evening bus
      for (let seat = 1; seat <= 40; seat++) {
        await query(
          'INSERT INTO seats (show_id, seat_number, status) VALUES ($1, $2, $3)',
          [eveningBus.rows[0].id, seat, 'available']
        );
      }
      
      console.log(`Created buses for ${tripDate.toDateString()}`);
    }
    
    console.log('Successfully populated bus trips!');
    console.log('Total: 10 bus trips (2 per day for 5 days), 40 seats each');
    
  } catch (error) {
    console.error('Error populating bus trips:', error);
  }
}

populateBusTrips();
