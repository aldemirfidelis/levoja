/**
 * Entrada do app: a tarefa de localização em segundo plano precisa ser registrada no escopo global,
 * antes do roteador — o sistema pode iniciar o JS sem interface (app fechado) só para entregar posições.
 */
import './src/lib/env';
import './src/lib/location';
import 'expo-router/entry';
