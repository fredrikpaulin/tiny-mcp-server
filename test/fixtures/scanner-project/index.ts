import { AppServer } from "./server";
import { Database } from "./utils/db";

const db = new Database("./data.db");
const server = new AppServer(db);
server.start();
